package com.nikatru.platform_storage

import android.app.Activity
import android.content.Context
import com.google.android.play.agesignals.AgeSignalsAccessRequest
import com.google.android.play.agesignals.AgeSignalsManagerFactory
import com.google.android.play.agesignals.AgeSignalsRequest
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * [ADR 082] §5 — reads Google Play Age Signals (beta) for the sign-up age gate.
 * Part of `nikatru_platform_storage` (39-CHASSIS §2: platform capabilities land there).
 *
 * USE RESTRICTION (Play Age Signals terms, accepted by the owner 2026-09-15): the
 * answer is used ONLY to decide whether an account may be created — an
 * age-appropriate experience. It is never used for analytics, advertising,
 * marketing or profiling, and this class never stores, logs or sends it: it is
 * handed to Dart once, decided on there, and discarded.
 *
 * Returns the raw fields only — `accessStatus`, `ageLower`, `ageUpper` — or
 * `error: true`. What they MEAN is `core.ageSignalFromPlay`, tested in Dart.
 */
class AgeSignalsPlugin : FlutterPlugin, MethodChannel.MethodCallHandler, ActivityAware {
    private var channel: MethodChannel? = null
    private var context: Context? = null
    private var activity: Activity? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "nikatru/age_signals").also {
            it.setMethodCallHandler(this)
        }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel?.setMethodCallHandler(null)
        channel = null
        context = null
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivity() {
        activity = null
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (call.method != "read") {
            result.notImplemented()
            return
        }
        val ctx = context
        val act = activity
        if (ctx == null || act == null) {
            result.success(mapOf("error" to true))
            return
        }
        try {
            val manager = AgeSignalsManagerFactory.create(ctx)
            val access = AgeSignalsAccessRequest.builder().setActivity(act).build()
            manager.requestAgeSignalsAccess(access)
                .addOnSuccessListener { accessResult ->
                    val status = accessResult.ageSignalsStatus().toString()
                    if (status != "SHARED") {
                        result.success(mapOf("accessStatus" to status))
                        return@addOnSuccessListener
                    }
                    manager.checkAgeSignals(AgeSignalsRequest.builder().build())
                        .addOnSuccessListener { signals ->
                            result.success(
                                mapOf(
                                    "accessStatus" to status,
                                    "ageLower" to signals.ageLower(),
                                    "ageUpper" to signals.ageUpper(),
                                ),
                            )
                        }
                        .addOnFailureListener { result.success(mapOf("error" to true)) }
                }
                .addOnFailureListener { result.success(mapOf("error" to true)) }
        } catch (_: Exception) {
            result.success(mapOf("error" to true))
        }
    }
}
