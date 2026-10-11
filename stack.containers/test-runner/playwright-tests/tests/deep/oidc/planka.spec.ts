import { test, expect, type Page } from '@playwright/test';
import { assertPlankaDisplayName, testOIDCService, testUser } from '../shared/oidc';
import { serviceUrl } from '../../../utils/stack-urls';
import { KeycloakClient } from '../../../utils/keycloak-client';
import { randomUUID } from 'crypto';

async function nativeHeaders(page: Page, username: string, profile?: { email: string; displayName: string }) {
  // Exact Planka 1.26.3 client storage: native app token, never a provider cookie.
  const cookies = await page.context().cookies(serviceUrl('planka'));
  const version = cookies.find(cookie => cookie.name === 'accessTokenVersion')?.value;
  const token = version === '1' ? cookies.find(cookie => cookie.name === 'accessToken')?.value : undefined;
  if (!token) throw new Error('Planka native authenticated API session unavailable');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (profile) {
    const response = await page.request.get(serviceUrl('planka', '/api/users/me'), { headers });
    expect(response.ok(), 'native current-user API must authenticate the separate test admin').toBeTruthy();
    const user = (await response.json()).item;
    expect(user.username).toBe(username);
    expect(user.email).toBe(profile.email);
    expect(user.name).toBe(profile.displayName);
    expect(user.isAdmin, 'native declared admins-group mapping must grant the test admin role').toBe(true);
  } else {
    await assertPlankaDisplayName(page, token, username);
  }
  return headers;
}

const loginOptions = {
  disallowPatterns: [/Log in to Planka|Log in with SSO|E-mail or username/i, /Consent Request|the above application is requesting the following permissions/i],
  disallowUrlPatterns: [/\/login\b/i],
  loginPath: serviceUrl('planka', '/login'),
  loginButtonPatterns: [/log in with sso|sso|oidc/i],
  oidcLinkPatterns: [/log in with sso/i, /sso/i, /oidc/i],
  screenshotFullPage: false,
};

test('Planka - regular OIDC user cannot create admin projects', async ({ page }) => {
  test.setTimeout(120000);
  await testOIDCService(page, 'Planka', serviceUrl('planka'), /PLANKA/i,
    ['Keycloak', 'SSO', 'OIDC'], {
      ...loginOptions,
      postLogin: async page => {
        const headers = await nativeHeaders(page, testUser.username);
        const response = await page.request.post(serviceUrl('planka', '/api/projects'), {
          headers, data: { name: `P0 denied probe ${Date.now()}` },
        });
        expect(response.status(), 'ordinary SSO identity must not gain project-admin rights').toBe(403);
      },
    });
});

test('Planka - separate managed test admin creates a genuinely native board workflow', async ({ browser }) => {
  test.setTimeout(120000);
  const provider = KeycloakClient.fromEnvironment();
  const declaration = KeycloakClient.buildManagedUser(`playwright-planka-admin-${randomUUID()}`);
  declaration.groups = ['users', 'admins'];
  declaration.givenName = 'Playwright';
  declaration.familyName = 'Planka Admin';
  declaration.displayName = declaration.fullName = declaration.commonName = 'Playwright Planka Admin';
  // Normal authorized test-client provisioning; never elevate the ordinary user,
  // touch owner credentials, or edit a native app database to bypass permissions.
  if (await provider.getUserProfile(declaration.username)) throw new Error('Refusing test-admin identity collision');
  const admin = await provider.createManagedUser(declaration);
  // A separate empty browser context avoids reusing the regular user's SSO session.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, ignoreHTTPSErrors: false });
  const page = await context.newPage();
  let cleanup: (() => Promise<void>) | undefined;
  let cleanupNativeUser: (() => Promise<void>) | undefined;
  try {
    await testOIDCService(page, 'Planka', serviceUrl('planka'),
      /Stack Demo Board|Backlog|In Progress|Done|Bazel migration rollout|Playwright screenshot sweep/i,
      ['Keycloak', 'SSO', 'OIDC'], {
        ...loginOptions,
        authUsername: admin.username,
        authPassword: admin.password,
        postLogin: async page => {
          const headers = await nativeHeaders(page, admin.username, { email: admin.email, displayName: 'Playwright Planka Admin' });
          const api = serviceUrl('planka', '/api');
          const self = (await (await page.request.get(`${api}/users/me`, { headers })).json()).item;
          cleanupNativeUser = async () => {
            const response = await page.request.delete(`${api}/users/${self.id}`, { headers });
            if (!response.ok()) throw new Error(`Planka native test-admin cleanup failed: HTTP ${response.status()}`);
          };
          const post = async (url: string, data: Record<string, unknown>) => {
            const response = await page.request.post(url, { headers, data });
            if (!response.ok()) throw new Error(`Planka native workflow request failed: HTTP ${response.status()}`);
            return (await response.json()).item;
          };
          const suffix = `${Date.now()}`;
          // Only unique newly created synthetic workflow data; never overwrite owner projects.
          const project = await post(`${api}/projects`, { name: `P0 native acceptance ${suffix}` });
          cleanup = async () => {
            const response = await page.request.delete(`${api}/projects/${project.id}`, { headers });
            if (!response.ok()) throw new Error(`Planka native acceptance cleanup failed: HTTP ${response.status()}`);
          };
          const board = await post(`${api}/projects/${project.id}/boards`, { name: 'Stack Demo Board', position: 65536, requestId: `p0-${suffix}` });
          const definitions = [
            { list: 'Backlog', card: 'Bazel migration rollout' },
            { list: 'In Progress', card: 'Playwright screenshot sweep' },
            { list: 'Done', card: 'Edge secret injection' },
          ];
          for (const item of definitions) {
            const list = await post(`${api}/boards/${board.id}/lists`, { name: item.list, position: 65536 });
            await post(`${api}/lists/${list.id}/cards`, { name: item.card, description: 'Synthetic native workflow acceptance data; not owner work.', position: 65536 });
          }
          await page.goto(serviceUrl('planka', `/boards/${board.id}`), { waitUntil: 'domcontentloaded', timeout: 30000 });
          await expect(page.getByText('Stack Demo Board', { exact: false }).first()).toBeVisible({ timeout: 30000 });
          for (const item of definitions) {
            await expect(page.getByText(item.list, { exact: true }).first()).toBeVisible({ timeout: 30000 });
            await expect(page.getByText(item.card, { exact: false }).first()).toBeVisible({ timeout: 30000 });
          }
        },
      });
  } finally {
    try {
      if (cleanup) await cleanup();
    } finally {
      try { if (cleanupNativeUser) await cleanupNativeUser(); } finally {
        try { await context.close(); } finally { await provider.deleteUser(admin.keycloakUserId!); }
      }
    }
  }
});
