#!/usr/bin/env python3
from pathlib import Path
import unittest

class NativeEvidenceTests(unittest.TestCase):
    def test_no_substitute_dom_or_api_failure_fallback(self):
        root = Path(__file__).resolve().parents[1]
        text = (root / 'stack.containers/test-runner/playwright-tests/tests/deep/oidc/planka.spec.ts').read_text()
        for forbidden in ['createElement', 'innerHTML', '__planka-board-evidence', 'injectPlankaBoardEvidence', 'using UI evidence fallback']:
            self.assertNotIn(forbidden, text)
        self.assertIn('native authenticated API session unavailable', text)
        self.assertIn("cookie.name === 'accessTokenVersion'", text)
        self.assertIn("version === '1'", text)
        self.assertIn("cookie.name === 'accessToken'", text)
        self.assertIn('page.request.post', text)
        self.assertIn('page.request.delete', text)
        self.assertIn('toBe(403)', text)
        self.assertIn('requireStackAdminCredentials', text)
        self.assertIn('ignoreHTTPSErrors: false', text)
        self.assertIn('toBeVisible', text)

if __name__ == '__main__':
    unittest.main()
