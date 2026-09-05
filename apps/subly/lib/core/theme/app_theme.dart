// Re-export shim: theming now lives in packages/design_system.
// Kept so existing `core/theme/app_theme.dart` imports (AppTheme, AppText)
// compile unchanged; buildAppTheme is exposed for new call sites.
export 'package:nikatru_design_system/nikatru_design_system.dart'
    show
        AppTheme,
        AppText,
        buildAppTheme,
        AppThemeX,
        AppScaffold,
        AppDestination,
        AppSpacing,
        AppRadius;
