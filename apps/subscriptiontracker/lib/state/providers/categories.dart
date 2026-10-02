// ST-T9 (AD-05) — categories BY ID. Re-exported from `../providers.dart`.

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_client.dart';
import '../../data/models/category.dart';
import 'subscriptions.dart' show apiClientProvider;

/// The categories a row can be filed under: the built-ins (localised by id
/// where they are shown) plus the user's own from `GET /v1/categories`.
///
/// A client that serves no categories ([CategoriesApi] absent) — and a read
/// that fails — yields the built-ins alone: the picker always has the ten
/// names the app has offered since ST-T1, never an empty list.
class CategoriesController extends AsyncNotifier<List<SubscriptionCategory>> {
  CategoriesApi? get _api {
    final ApiClient api = ref.read(apiClientProvider);
    return api is CategoriesApi ? api as CategoriesApi : null;
  }

  @override
  Future<List<SubscriptionCategory>> build() async {
    ref.watch(apiClientProvider);
    final CategoriesApi? api = _api;
    if (api == null) return kBuiltinCategoryRows;
    try {
      return await api.getCategories();
    } on Object {
      return kBuiltinCategoryRows;
    }
  }

  /// `POST /v1/categories`, then a fresh list.
  Future<void> add(String name) async {
    await _require().createCategory(name.trim());
    ref.invalidateSelf();
    await future;
  }

  /// `PATCH /v1/categories/:id`. The server moves every row and the budget
  /// cap to the new name in the same batch; the caller refreshes those reads.
  Future<void> rename(String id, String name) async {
    await _require().renameCategory(id, name.trim());
    ref.invalidateSelf();
    await future;
  }

  /// `DELETE /v1/categories/:id`.
  Future<void> remove(String id) async {
    await _require().deleteCategory(id);
    ref.invalidateSelf();
    await future;
  }

  CategoriesApi _require() =>
      _api ?? (throw UnsupportedError('this client serves no categories'));
}

final AsyncNotifierProvider<CategoriesController, List<SubscriptionCategory>>
categoriesProvider =
    AsyncNotifierProvider<CategoriesController, List<SubscriptionCategory>>(
      CategoriesController.new,
    );
