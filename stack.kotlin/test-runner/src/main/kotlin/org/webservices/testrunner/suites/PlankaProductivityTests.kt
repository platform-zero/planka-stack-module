package org.webservices.testrunner.suites

import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import org.webservices.testrunner.framework.*

suspend fun TestRunner.plankaProductivityTests() = suite("Planka Productivity Tests") {
test("Planka board server is healthy") {
        val response = client.getRawResponse("${env.endpoints.planka}/")
        response.status shouldBe HttpStatusCode.OK
    }

    test("Planka web app loads") {
        val response = client.getRawResponse("${env.endpoints.planka}/")
        val body = response.bodyAsText()
        body.uppercase() shouldContain "<!DOCTYPE HTML>"
    }
}
