package com.nikatru.platform_storage

import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * ⏱ 2026-09-29 · native sign-in attestation (⏱ 2026-09-30 · wire protocol v2;
 * this side is unchanged by it: it sees only the hash) — the android
 * proof: a Play Integrity CLASSIC token whose nonce is the request hash the Dart
 * side computed over the op's clientData. Registered on `nikatru/native_attest`
 * by [AgeSignalsPlugin], the package's one pluginClass.
 *
 * `playIntegrityToken({nonce, cloudProjectNumber?})` answers `{token}` or
 * `{error: true, code}`. It never throws across the channel: every failure is
 * the error map, and the Dart side turns that into a failed sign-in call, never
 * into a request sent without a proof.
 *
 * The token is handed to Dart once and sent to the platform Worker, which asks
 * Google to decode it. Nothing here stores or logs it.
 */
class NativeAttestHandler(private val context: Context) : MethodChannel.MethodCallHandler {
    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (call.method != "playIntegrityToken") {
            result.notImplemented()
            return
        }
        val nonce: String? = call.argument<String>("nonce")
        if (nonce == null || nonce.isEmpty()) {
            result.success(mapOf("error" to true, "code" to "no_nonce"))
            return
        }
        val projectNumber: Number? = call.argument<Number>("cloudProjectNumber")
        try {
            val base = IntegrityTokenRequest.builder().setNonce(nonce)
            val request = if (projectNumber != null) {
                base.setCloudProjectNumber(projectNumber.toLong()).build()
            } else {
                base.build()
            }
            IntegrityManagerFactory.create(context)
                .requestIntegrityToken(request)
                .addOnSuccessListener { response ->
                    val token: String? = response.token()
                    if (token == null || token.isEmpty()) {
                        result.success(mapOf("error" to true, "code" to "no_token"))
                    } else {
                        result.success(mapOf("token" to token))
                    }
                }
                .addOnFailureListener { e ->
                    result.success(mapOf("error" to true, "code" to errorCode(e)))
                }
        } catch (e: Exception) {
            result.success(mapOf("error" to true, "code" to errorCode(e)))
        }
    }

    /**
     * The Play Integrity error code (its message leads with it, e.g. `-12`), else
     * the exception's class name. Never the message itself.
     */
    private fun errorCode(e: Exception): String {
        val message: String = e.message ?: ""
        val match: MatchResult? = Regex("-?[0-9]+").find(message)
        return match?.value ?: e.javaClass.simpleName
    }
}
