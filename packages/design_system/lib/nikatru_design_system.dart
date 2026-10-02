/// NIKATRU design system — brand tokens, theming and an adaptive navigation
/// shell shared across the Cross Platform Apps portfolio.
library;

export 'src/licences/vendored_asset_licences.dart';
export 'src/logging/release_logging.dart';
// The plumbing under the chassis's persisted controllers ([ADR 072] D1.4).
export 'src/persisted_notifier.dart';
export 'src/tokens/app_colors.dart';
// The brightness-resolved palette (ST-D0 D0-2); `AppColors`' neutrals alias it.
export 'src/tokens/app_palette.dart';
// The GENERATED company brand tokens — the one Dart file emitted from
// contracts/tokens/dtcg/ ([ADR 067] decision 1). It is on the barrel for the
// same reason `app_colors.dart` is: measured 2026-09-05, every app reaches this
// package through this file and nothing in apps/ imports a `src/` path, so a
// token that is not exported here is a token no app can read — and the PR that
// added it claimed a token change now reaches the Flutter apps while the
// hand-written palette was on the public API and the generated one was not.
export 'src/tokens/brand_tokens.dart';
export 'src/tokens/app_text.dart';
export 'src/tokens/app_spacing.dart';
export 'src/tokens/app_type_ramp.dart';
export 'src/tokens/status_tones.dart';
export 'src/theme/app_button_styles.dart';
export 'src/theme/app_theme_x.dart';
export 'src/theme/build_app_theme.dart';
export 'src/theme/form_tones.dart';
export 'src/widgets/app_card.dart';
export 'src/widgets/app_detail_header.dart';
export 'src/widgets/app_fab.dart';
export 'src/widgets/app_figure_tile.dart';
export 'src/widgets/app_icon_action.dart';
export 'src/widgets/app_list_group.dart';
export 'src/widgets/app_list_row.dart';
export 'src/widgets/adaptive_sheet.dart';
export 'src/widgets/app_monogram.dart';
export 'src/widgets/app_scaffold.dart';
export 'src/widgets/app_section_header.dart';
export 'src/widgets/app_summary_card.dart';
export 'src/widgets/brand_lockup.dart';
export 'src/widgets/auth_field.dart';
export 'src/widgets/auth_frame.dart';
export 'src/widgets/content_pane.dart';
export 'src/widgets/data_state.dart';
export 'src/widgets/decision_strip.dart';
export 'src/widgets/destructive_confirm_dialog.dart';
export 'src/widgets/destructive_outcome_notice.dart';
export 'src/widgets/form_sheet.dart';
export 'src/widgets/list_controls.dart';
export 'src/widgets/month_grid.dart';
export 'src/widgets/permission_priming.dart';
export 'src/widgets/skeleton_list.dart';
export 'src/widgets/system_screens.dart';
export 'src/widgets/two_pane.dart';
export 'src/widgets/focusable_tap.dart';
export 'src/widgets/nav_shell.dart';
export 'src/widgets/force_update_gate.dart';
export 'src/widgets/paywall_gate.dart';
export 'src/widgets/promo_card.dart';
export 'src/widgets/promo_objection_control.dart';
export 'src/widgets/promo_surface.dart';
export 'src/widgets/swallow_system_back.dart';
export 'src/platform/document_language.dart' show resolveAndLabelPage;

// ── THE CHASSIS STRINGS ([ADR 067] decision 2, unit `chassis-l10n`) ──────────
// `ChassisLocalizations` is gen-l10n output over `src/l10n/chassis_*.arb`, and
// `ChassisL10nX` is the one-token accessor the brick screens read it through.
// Both are on the barrel for the reason `brand_tokens.dart` is: measured on this
// tree, every app reaches this package through this file and nothing in `apps/`
// imports a `src/` path, so a name that is not exported here is a name no app
// can read. The app composes `ChassisLocalizations.delegate` BESIDE its own
// `AppLocalizations.localizationsDelegates` — neither replaces the other.
export 'src/l10n/chassis_localizations.dart';
export 'src/l10n/chassis_l10n_x.dart';
