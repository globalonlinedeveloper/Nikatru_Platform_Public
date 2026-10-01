package com.nikatru.platform_storage

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.MessageDigest

/**
 * ⏱ 2026-10-01 · DEVICE INTEGRITY (row O-APPS-GOV-IN-VAPT-CHECKLIST) — the
 * android half of `core`'s `DeviceIntegrityProbe`. Registered on
 * `nikatru/device_integrity` by [AgeSignalsPlugin], the package's one pluginClass.
 *
 * Two methods, both RAW FACTS — what they MEAN is decided in Dart
 * (`core.detectRoot`, `core.compareSigner`), where it is unit tested:
 *
 *  · `rootSignals` → `{signals: [wire names]}`: an `su` binary on a usual path,
 *    a test-keys OS build, a Magisk path or package, `/system` mounted
 *    read-write. Only presence checks — nothing is executed, nothing is written.
 *    The package lookup sees a root manager only below API 30: package
 *    visibility hides it above, and declaring `<queries>` for root tools would
 *    add them to every app's merged manifest for a signal the paths already
 *    give. A hidden package reads as absent, never as an error.
 *  · `signingCertificates` → `{sha256: [hex], multipleSigners: bool}`: the
 *    SHA-256 of this package's own signing certificates. API 28+ reads
 *    `GET_SIGNING_CERTIFICATES` (the rotation lineage, or every signer when
 *    there are several); below 28 the deprecated `GET_SIGNATURES`.
 *
 * Neither ever throws across the channel: a failure is `{error: true}`, which
 * Dart records as unreadable and never blocks on. Nothing here logs.
 */
class DeviceIntegrityHandler(private val context: Context) : MethodChannel.MethodCallHandler {
    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "rootSignals" -> result.success(safely { mapOf("signals" to rootSignals()) })
            "signingCertificates" -> result.success(safely { signingCertificates() })
            else -> result.notImplemented()
        }
    }

    private fun safely(read: () -> Map<String, Any>): Map<String, Any> =
        try {
            read()
        } catch (_: Exception) {
            mapOf("error" to true)
        }

    private fun rootSignals(): List<String> {
        val signals = mutableListOf<String>()
        if (SU_PATHS.any { File(it).exists() }) signals.add("su_binary")
        if (Build.TAGS?.contains("test-keys") == true) signals.add("test_keys")
        if (MAGISK_PATHS.any { File(it).exists() } || ROOT_PACKAGES.any(::isInstalled)) {
            signals.add("magisk_path")
        }
        if (systemIsWritable()) signals.add("writable_system")
        return signals
    }

    @Suppress("DEPRECATION")
    private fun isInstalled(pkg: String): Boolean =
        try {
            context.packageManager.getPackageInfo(pkg, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }

    /** `/system` (or `/`) mounted `rw` in /proc/mounts. */
    private fun systemIsWritable(): Boolean {
        val mounts = File("/proc/mounts")
        if (!mounts.canRead()) return false
        return mounts.readLines().any { line ->
            val parts = line.split(" ")
            parts.size >= 4 &&
                (parts[1] == "/system" || parts[1] == "/") &&
                parts[3].split(",").contains("rw")
        }
    }

    @SuppressLint("PackageManagerGetSignatures")
    @Suppress("DEPRECATION")
    private fun signingCertificates(): Map<String, Any> {
        val pm = context.packageManager
        val name = context.packageName
        val signatures: Array<Signature>
        var multiple = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info: PackageInfo = pm.getPackageInfo(name, PackageManager.GET_SIGNING_CERTIFICATES)
            val signing = info.signingInfo ?: return mapOf("error" to true)
            multiple = signing.hasMultipleSigners()
            signatures = (if (multiple) signing.apkContentsSigners else signing.signingCertificateHistory)
                ?: return mapOf("error" to true)
        } else {
            val info: PackageInfo = pm.getPackageInfo(name, PackageManager.GET_SIGNATURES)
            signatures = info.signatures ?: return mapOf("error" to true)
            multiple = signatures.size > 1
        }
        val digests = signatures.map { sha256Hex(it.toByteArray()) }
        return mapOf("sha256" to digests, "multipleSigners" to multiple)
    }

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02X".format(it) }

    private companion object {
        val SU_PATHS = listOf(
            "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/su",
            "/system/bin/.ext/su", "/system/usr/we-need-root/su", "/data/local/su",
            "/data/local/bin/su", "/data/local/xbin/su", "/su/bin/su", "/vendor/bin/su",
        )
        val MAGISK_PATHS = listOf(
            "/sbin/.magisk", "/data/adb/magisk", "/data/adb/modules", "/cache/.disable_magisk",
            "/dev/.magisk.unblock", "/system/app/Superuser.apk",
        )
        val ROOT_PACKAGES = listOf(
            "com.topjohnwu.magisk", "eu.chainfire.supersu", "com.koushikdutta.superuser",
            "com.noshufou.android.su", "me.weishu.kernelsu",
        )
    }
}
