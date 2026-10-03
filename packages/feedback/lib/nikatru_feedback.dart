/// "Report a problem" — the one feedback sheet every app adopts (lane
/// feedback-intake). The app builds a [FeedbackHost] over its own providers and
/// calls [openReportProblem] from the chassis Help section; the screenshot is
/// taken under design_system's ScreenCaptureBoundary, which the app root mounts.
library;

export 'src/capture.dart';
export 'src/host.dart';
export 'src/l10n/feedback_strings.g.dart';
export 'src/markup_editor.dart' show MarkupEditorPage, MarkupKeys, ShotPreview;
export 'src/outbox.dart';
export 'src/report.dart';
export 'src/report_page.dart';
