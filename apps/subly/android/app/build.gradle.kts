import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// ─────────────────────────────────────────────────────────────────────────────
// RELEASE SIGNING — the SHAPE is here; the KEY is not, and its absence is a
// recorded owner decision rather than an unfinished edge.
//
// [pipeline R-3] / tooling/channel-register.json `android-play`.signing:
// keyKind is "upload-key" — with Play App Signing, Google holds the key end
// users' installs are bound to and we hold only the key that authenticates an
// upload. Losing ours is a reset-and-continue, not the unrecoverable event an
// `app-signing-key` loss would be.
//
// 🔒 NOTHING BELOW WIRES A REAL KEY, AND THAT IS DELIBERATE. Until the owner
// supplies one (OWNER_QUEUE A-3 / S-5), the release build resolves to the debug
// signing config exactly as it did before — a debug-signed BUILD PROOF is what
// build-platforms.yml's android lane is for, and the review fleet has already
// refuted "debug-signed Android" as a defect. What this block adds is only that
// the day a keystore exists, it is supplied as CONFIGURATION rather than as a
// code change: put it in `android/key.properties` locally, or hand the four
// values to CI as secrets, and the release build picks it up.
//
// 🔴 HALF A KEYSTORE FAILS THE BUILD. That is the only interesting decision
// here. Silently falling back to debug when three of four values are present
// would produce a debug-signed .aab from a run that looked like a signing run —
// an artifact nobody can explain, uploaded to a store that accepts each upload
// key exactly once. This repo has met that shape before under a different name
// ("half configured" package identity, [10]D-5), and the answer is the same:
// fail loudly on the partial state, print nothing-configured as the expected
// state, and only trust the fully-configured one.
//
// ⚠️ UNPROVEN OPEN PATH, STATED RATHER THAN HIDDEN. The `hasReleaseSigning ==
// true` branch has never executed: no keystore exists, and Android cannot be
// built on the owner's box at all (CLAUDE.md — java.nio Selector.open() fails
// process-wide from a Windows socket-layer defect). CI exercises the FALLBACK
// path on every android build; the signing path is exercised the first time a
// keystore is supplied. tooling/release/submit-play.mjs prints the current
// posture on every run so this gap cannot go quiet.
// ─────────────────────────────────────────────────────────────────────────────
val releaseSigningEnv = mapOf(
    "storeFile" to "ANDROID_KEYSTORE_PATH",
    "storePassword" to "ANDROID_KEYSTORE_PASSWORD",
    "keyAlias" to "ANDROID_KEY_ALIAS",
    "keyPassword" to "ANDROID_KEY_PASSWORD",
)

// `android/key.properties` — Flutter's own convention, and gitignored. Read
// first so a local developer's file beats an inherited environment variable
// instead of the two silently fighting.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

val signingValue: (String) -> String? = { key ->
    val fromFile = keystoreProperties.getProperty(key)?.trim()
    if (!fromFile.isNullOrEmpty()) {
        fromFile
    } else {
        val fromEnv = System.getenv(releaseSigningEnv.getValue(key))?.trim()
        if (fromEnv.isNullOrEmpty()) null else fromEnv
    }
}

val suppliedSigningKeys = releaseSigningEnv.keys.filter { signingValue(it) != null }
val hasReleaseSigning = suppliedSigningKeys.size == releaseSigningEnv.size

if (suppliedSigningKeys.isNotEmpty() && !hasReleaseSigning) {
    val missing = releaseSigningEnv.keys.filterNot { it in suppliedSigningKeys }
    throw GradleException(
        buildString {
            appendLine("Release signing is HALF configured and this build refuses to guess.")
            appendLine("  supplied: ${suppliedSigningKeys.joinToString(", ")}")
            appendLine("  missing:  ${missing.joinToString(", ")}")
            appendLine("Supply all four (android/key.properties, or the environment variables")
            appendLine("${releaseSigningEnv.values.joinToString(", ")}), or supply none and get the")
            appendLine("debug-signed build proof. Falling back to debug here would produce a")
            appendLine("debug-signed artifact from a run that looked like a signing run.")
        },
    )
}

// Resolved eagerly so a wrong path fails NOW with a message that names the file,
// not later inside the signer with one that does not.
val releaseKeystoreFile = if (hasReleaseSigning) {
    val raw = signingValue("storeFile")!!
    val f = File(raw).let { if (it.isAbsolute) it else rootProject.file(raw) }
    if (!f.exists()) {
        throw GradleException(
            "Release keystore not found at ${f.absolutePath} (from \"$raw\"). " +
                "A relative path is resolved against ${rootProject.projectDir}.",
        )
    }
    f
} else {
    null
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE PLAY API-LEVEL FLOOR IS PINNED HERE, NOT INHERITED FROM THE TOOLCHAIN.
//
// Until 2026-08-04 this file read `targetSdk = flutter.targetSdkVersion`, which
// resolves out of the INSTALLED Flutter SDK — `packages/flutter_tools/gradle/
// src/main/kotlin/FlutterExtension.kt`, where 3.44.x happens to declare 36. So
// the app met Google Play's floor BY ACCIDENT OF WHICH FLUTTER WAS INSTALLED.
// Pinning `flutter-version: 3.44.8` in the workflows does not fix that: it moves
// the dependency, it does not remove it. Downgrade the pin, or build on a box
// with an older SDK, and `targetSdk` drops with no diff in this file, no error
// from Gradle, and no failing test — the first symptom is Play REJECTING the
// upload, after the build, after CI is green.
//
// The floor and its citation are NOT restated here — that would be a second
// source of truth for the same number. They live in the duty row
// `play-target-api-level` in tooling/legal/duty-matrix.json (with the
// developer.android.com URL and the date it was read), and
// tooling/ci/assert-android-target-sdk.mjs reads the floor FROM that row and
// compares it to the literal below. Change one without the other and CI fails.
//
// ⚠️ `compileSdk` IS PINNED FOR A DIFFERENT REASON. AGP requires
// compileSdk >= targetSdk. Left as `flutter.compileSdkVersion` it would track
// the toolchain while targetSdk stood still, so an SDK downgrade turns a policy
// problem into a build break — loud, but only on a machine that can build
// Android, which is CI alone (CLAUDE.md: java.nio Selector.open() fails
// process-wide on the owner's box). As a literal, the guard checks the
// relationship statically, before any build.
//
// `minSdk` is deliberately still toolchain-resolved: Google Play sets no
// minimum-minSdk floor, so there is nothing to pin it against, and inventing a
// number here is the sin assert-store-metadata.mjs exists to refuse.
// ─────────────────────────────────────────────────────────────────────────────
android {
    namespace = "com.nikatru.subly"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // REQUIRED by flutter_local_notifications (via packages/notifications).
        // It calls java.time APIs that do not exist below API 26, so the build
        // fails at :app:checkReleaseAarMetadata with "requires core library
        // desugaring to be enabled" — an error that names the mechanism, not
        // the plugin, and so reads as a Gradle config problem rather than a
        // dependency requirement. Every stamped app that wires notifications
        // will hit this.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.nikatru.subly"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        // See the PLAY API-LEVEL FLOOR block above. The floor itself and its
        // primary source live in tooling/legal/duty-matrix.json; this literal is
        // what tooling/ci/assert-android-target-sdk.mjs compares against it.
        targetSdk = 36
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = releaseKeystoreFile
                storePassword = signingValue("storePassword")
                keyAlias = signingValue("keyAlias")
                keyPassword = signingValue("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // See the RELEASE SIGNING block at the top of this file. With no
            // keystore supplied this is the debug config — unchanged behaviour,
            // and a recorded owner decision, not a TODO nobody did.
            signingConfig =
                if (hasReleaseSigning) {
                    signingConfigs.getByName("release")
                } else {
                    signingConfigs.getByName("debug")
                }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // The desugaring runtime that `isCoreLibraryDesugaringEnabled` above needs.
    // Both halves are required — enabling the flag without this dependency
    // fails the build just as surely as omitting the flag.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

flutter {
    source = "../.."
}
