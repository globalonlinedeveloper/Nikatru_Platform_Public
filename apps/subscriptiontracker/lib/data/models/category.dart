/// A subscription category BY ID (ST-T9, AD-05) — the API's `/v1/categories`
/// row (services/subscriptiontracker-api routes/categories.ts, migration
/// 0005): a built-in every user shares, or one of the user's own.
///
/// The ID is what a row and a budget cap should follow; the NAME is what the
/// server still stores beside it on a subscription and a cap, and what a
/// rename rewrites in one batch on both — which is why renaming keeps a
/// category's cap and its rows.
class SubscriptionCategory {
  const SubscriptionCategory({
    required this.id,
    required this.name,
    required this.builtin,
  });

  factory SubscriptionCategory.fromJson(Map<String, dynamic> j) =>
      SubscriptionCategory(
        id: j['id'].toString(),
        name: (j['name'] ?? '') as String,
        builtin: j['builtin'] == true || j['builtin'] == 1,
      );

  final String id;
  final String name;
  final bool builtin;

  @override
  bool operator ==(Object other) =>
      other is SubscriptionCategory &&
      other.id == id &&
      other.name == name &&
      other.builtin == builtin;

  @override
  int get hashCode => Object.hash(id, name, builtin);
}

/// The built-ins, id → stored English name — migration 0005's seed rows,
/// which are the ten names the app offered before categories had ids
/// (`DemoData.budget()`). The DISPLAY name is localised by id
/// (`builtinCategoryLabel` in features/settings/categories_manager.dart, and
/// `categoryLabel` in core/format/category_label.dart for a stored name); this
/// name is the stored value the server matches on.
const Map<String, String> kBuiltinCategories = <String, String>{
  'streaming': 'Streaming',
  'music': 'Music',
  'ai_tools': 'AI tools',
  'creative': 'Creative',
  'fitness': 'Fitness',
  'developer': 'Developer',
  'productivity': 'Productivity',
  'cloud': 'Cloud',
  'news': 'News',
  'security': 'Security',
};

/// The built-ins as rows, in the order the picker lists them.
final List<SubscriptionCategory> kBuiltinCategoryRows = <SubscriptionCategory>[
  for (final MapEntry<String, String> e in kBuiltinCategories.entries)
    SubscriptionCategory(id: e.key, name: e.value, builtin: true),
];
