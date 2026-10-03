import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppSpacing;
import 'package:nikatru_feedback/nikatru_feedback.dart'
    show FeedbackCategory, FeedbackHost, openReportProblem;

import 'assistant.dart';
import 'help_index.dart';
import 'l10n/help_strings.g.dart';
import 'search.dart';

/// The help centre's keys, so a test finds a CONTROL and not a string.
abstract final class HelpCentreKeys {
  static const Key search = Key('help.search');
  static const Key results = Key('help.results');
  static const Key noResults = Key('help.noResults');
  static const Key knownIssues = Key('help.knownIssues');
  static const Key noKnownIssues = Key('help.noKnownIssues');
  static const Key askUs = Key('help.askUs');
  static const Key accessibility = Key('help.accessibility');
  static const Key chatEntry = Key('help.chatEntry');

  /// The article tile for [id] (`<scope>/<slug>`).
  static Key article(String id) => Key('help.article.$id');

  /// The "Ask us" button at the end of the article [id].
  static Key articleAsk(String id) => Key('help.article.$id.ask');
}

/// The published accessibility statement (lane a11y-statement).
const String kHelpAccessibilityUrl = 'https://nikatru.com/accessibility';

/// The words of the Settings row that opens the help centre, in the app's language.
String helpCentreLabelOf(BuildContext context) =>
    HelpStrings.of(Localizations.localeOf(context)).helpCentreTitle;

/// Opens the help centre over [context] (lane help-search): what Settings'
/// Help row calls, in every app and in the brick, through the chassis.
///
/// [indexTable] and [sourceLocale] are the app's own generated table
/// (`lib/help/help_index.g.dart`: `kHelpIndexJson`, `kHelpSourceLocale`).
Future<void> openHelpCentre(
  BuildContext context, {
  required FeedbackHost host,
  required String appId,
  required Map<String, String> indexTable,
  required String sourceLocale,
  required Future<void> Function(String url) openUrl,
  Set<String>? scopes,
  HelpChatGate chatGate = HelpChatGate.off,
  WidgetBuilder? chatEntry,
}) {
  final language = Localizations.localeOf(context).languageCode;
  return Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (_) => HelpCentrePage(
        index: helpIndexFrom(indexTable, language, sourceLocale: sourceLocale),
        translated: helpIndexIsTranslated(indexTable, language),
        scopes: scopes ?? <String>{appId, 'account'},
        appId: appId,
        feedbackHost: host,
        openUrl: openUrl,
        chatGate: chatGate,
        chatEntry: chatEntry,
      ),
    ),
  );
}

/// The app's help centre: the articles of [scopes] from [index], searched on
/// the device as the person types (the query never leaves it), the published
/// known issues for [appId], a link to the accessibility statement, and —
/// after every article and under every search, found or not — "Still stuck?
/// Ask us", which opens packages/feedback's "Report a problem" sheet with
/// category `question` and the search text (or the article's title) filled in
/// and editable. Only what the person then SENDS leaves the device.
///
/// [chatEntry] is the help-ai-chat slot: built only when [helpChatAvailable]
/// holds for [chatGate] (flag on AND Pro AND AI credits). Nothing here calls a
/// model; [assistant] defaults to [SearchOnlyAssistant].
class HelpCentrePage extends StatefulWidget {
  const HelpCentrePage({
    super.key,
    required this.index,
    required this.scopes,
    required this.appId,
    required this.feedbackHost,
    required this.openUrl,
    this.translated = true,
    this.assistant = const SearchOnlyAssistant(),
    this.chatGate = HelpChatGate.off,
    this.chatEntry,
  });

  final HelpIndex index;
  final Set<String> scopes;

  /// The app whose known issues are shown (`apps:` in content/known-issues/).
  final String appId;
  final FeedbackHost feedbackHost;
  final Future<void> Function(String url) openUrl;

  /// False when the person's language has no articles of its own yet.
  final bool translated;
  final HelpAssistant assistant;
  final HelpChatGate chatGate;
  final WidgetBuilder? chatEntry;

  @override
  State<HelpCentrePage> createState() => _HelpCentrePageState();
}

class _HelpCentrePageState extends State<HelpCentrePage> {
  final TextEditingController _query = TextEditingController();

  @override
  void initState() {
    super.initState();
    _query.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  List<HelpDoc> get _docs {
    final q = _query.text.trim();
    if (q.isEmpty) {
      return <HelpDoc>[
        for (final d in widget.index.docs)
          if (widget.scopes.contains(d.scope)) d,
      ];
    }
    return <HelpDoc>[
      for (final h in widget.assistant.answer(
        widget.index,
        q,
        scopes: widget.scopes,
      ))
        h.doc,
    ];
  }

  Future<void> _ask(String text) => openReportProblem(
    context,
    widget.feedbackHost,
    category: FeedbackCategory.question,
    initialDescription: text,
  );

  @override
  Widget build(BuildContext context) {
    final s = HelpStrings.of(Localizations.localeOf(context));
    final theme = Theme.of(context);
    final docs = _docs;
    final query = _query.text.trim();
    final issues = <HelpKnownIssue>[
      for (final k in widget.index.knownIssues)
        if (k.apps.contains(widget.appId)) k,
    ];
    final chat = widget.chatEntry;
    return Scaffold(
      appBar: AppBar(title: Text(s.helpCentreTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[
            TextField(
              key: HelpCentreKeys.search,
              controller: _query,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                labelText: s.helpSearchLabel,
                prefixIcon: const Icon(Icons.search),
              ),
            ),
            if (!widget.translated) ...<Widget>[
              const SizedBox(height: AppSpacing.sm),
              Text(s.helpArticlesInEnglish, style: theme.textTheme.bodySmall),
            ],
            if (chat != null && helpChatAvailable(widget.chatGate))
              KeyedSubtree(key: HelpCentreKeys.chatEntry, child: chat(context)),
            const SizedBox(height: AppSpacing.lg),
            Column(
              key: HelpCentreKeys.results,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                if (docs.isEmpty)
                  Text(s.helpNoResults, key: HelpCentreKeys.noResults),
                for (final d in docs)
                  ExpansionTile(
                    key: HelpCentreKeys.article(d.id),
                    title: Text(d.title),
                    subtitle: Text(d.summary),
                    childrenPadding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      0,
                      AppSpacing.lg,
                      AppSpacing.lg,
                    ),
                    expandedCrossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      SelectableText(d.body),
                      const SizedBox(height: AppSpacing.sm),
                      TextButton(
                        key: HelpCentreKeys.articleAsk(d.id),
                        onPressed: () => _ask(query.isEmpty ? d.title : query),
                        child: Text('${s.helpStillStuck} ${s.helpAskUs}'),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            Semantics(
              header: true,
              child: Text(
                s.helpKnownIssuesTitle,
                style: theme.textTheme.titleMedium,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Column(
              key: HelpCentreKeys.knownIssues,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                if (issues.isEmpty)
                  Text(s.helpNoKnownIssues, key: HelpCentreKeys.noKnownIssues),
                for (final k in issues)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(k.title),
                    subtitle: Text(
                      k.status == 'fixed' && k.fixedIn != null
                          ? s.helpFixedIn(k.fixedIn!)
                          : k.text,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(s.helpStillStuck, style: theme.textTheme.titleMedium),
            const SizedBox(height: AppSpacing.sm),
            FilledButton(
              key: HelpCentreKeys.askUs,
              onPressed: () => _ask(query),
              child: Text(s.helpAskUs),
            ),
            const SizedBox(height: AppSpacing.lg),
            TextButton(
              key: HelpCentreKeys.accessibility,
              onPressed: () => widget.openUrl(kHelpAccessibilityUrl),
              child: Text(s.helpAccessibility),
            ),
          ],
        ),
      ),
    );
  }
}
