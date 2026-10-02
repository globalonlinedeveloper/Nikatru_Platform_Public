package com.nikatru.subscriptiontracker

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * IM-06 — SHARE INTO IMPORT. A `SEND` intent (AndroidManifest.xml) carrying
 * text, or a `.csv` / `.json` stream, is read HERE, on the device, and handed
 * to Dart over [CHANNEL] as `{name, text}`; `lib/state/share_inbox.dart`
 * opens `/import` with it. Nothing is uploaded.
 *
 *  · `initial` (Dart → here): the share that launched the activity, once.
 *  · `shared` (here → Dart): one that arrives while it runs (singleTop, so it
 *    lands in [onNewIntent] rather than a second copy of the app).
 *
 * ⏱ 2026-10-01 · XP-03 · a FRAGMENT activity, because local_auth_android's
 * BiometricPrompt needs a FragmentActivity host; on a plain FlutterActivity
 * every biometric unlock fails with `no_fragment_activity` and the lock screen
 * falls back to the PIN.
 */
class MainActivity : FlutterFragmentActivity() {
    private var channel: MethodChannel? = null
    private var pending: Map<String, String>? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        pending = sharedFrom(intent)
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).also {
            it.setMethodCallHandler { call, result ->
                if (call.method == "initial") {
                    result.success(pending)
                    pending = null
                } else {
                    result.notImplemented()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val shared = sharedFrom(intent) ?: return
        channel?.invokeMethod("shared", shared)
    }

    /** The shared text, or the shared file decoded as UTF-8; null for anything else. */
    private fun sharedFrom(intent: Intent?): Map<String, String>? {
        if (intent?.action != Intent.ACTION_SEND) return null
        intent.getStringExtra(Intent.EXTRA_TEXT)?.let { text ->
            if (text.isNotBlank()) return mapOf("name" to "shared text", "text" to text)
        }
        val uri: Uri = streamOf(intent) ?: return null
        return try {
            val bytes = contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(MAX_BYTES + 1)
                var read = 0
                while (read < buffer.size) {
                    val n = input.read(buffer, read, buffer.size - read)
                    if (n < 0) break
                    read += n
                }
                // Over the cap is not a subscription list; Dart refuses it too.
                if (read > MAX_BYTES) null else buffer.copyOf(read)
            } ?: return null
            mapOf("name" to displayName(uri), "text" to String(bytes, Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }

    private fun streamOf(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }

    private fun displayName(uri: Uri): String =
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
        } catch (e: Exception) {
            null
        } ?: "shared file"

    companion object {
        private const val CHANNEL = "com.nikatru.subscriptiontracker/share"

        /** `ImportedFile.maxBytes` in packages/core: 4 MiB. */
        private const val MAX_BYTES = 4 * 1024 * 1024
    }
}
