# ⏱ 2026-09-15 · apps.gov.in VAPT item V6 "no device logging in release"
# (tooling/ci/assert-android-vapt-manifest.mjs, O-APPS-GOV-IN-VAPT-CHECKLIST).
#
# Flutter's Gradle plugin turns R8 minify ON for release builds by default and adds
# this file to them when it exists (FlutterPlugin.kt: proguard-android-optimize.txt,
# flutter_proguard_rules.pro, then app/proguard-rules.pro). The rule below lets R8
# REMOVE every android.util.Log call from the release build — including the ones in
# code this repository does not write: Flutter's generated
# GeneratedPluginRegistrant.java (one Log.e per plugin) and third-party plugins.
# The guard grades the TRACKED sources; this is what holds the property for the rest.
#
# The methods are named rather than `{ *; }`: a wildcard also matches the members
# android.util.Log inherits from java.lang.Object, which R8 warns about.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
    public static int wtf(...);
    public static boolean isLoggable(java.lang.String, int);
    public static java.lang.String getStackTraceString(java.lang.Throwable);
    public static int println(int, java.lang.String, java.lang.String);
}
