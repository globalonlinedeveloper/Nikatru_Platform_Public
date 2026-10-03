/// The help centre (lane help-search): articles from content/help/, searched
/// on the device with the same ranker the sites and the extensions use
/// (tooling/help/search.mjs), the published known issues, and "Still stuck?
/// Ask us" into packages/feedback's report sheet. No model, no network, and no
/// query ever leaves the device.
library;

export 'src/assistant.dart';
export 'src/help_chat.dart';
export 'src/help_index.dart';
export 'src/help_page.dart';
export 'src/l10n/help_strings.g.dart';
export 'src/search.dart';
