import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'settings_screen.dart' show SettingsSection;

/// "Your devices" (SE-03) — the account's signed-in sessions, and signing ONE
/// OTHER device out. Every stamped app with accounts gets it; the app hands in
/// the two calls, already bound to its transport and its session token.
///
/// ⏱ 2026-10-01 · train ST-SETTINGS. Until this, the only session control
/// was "Log out of all devices", which ends the session in the person's hand
/// too. A lost phone should cost one tap on that phone's row, not a sign-in
/// on every device that is still trusted.
///
/// 🔴 THE CURRENT SESSION HAS NO SIGN-OUT BUTTON HERE. Signing this device out
/// is "Log out", which also forgets this device's per-user state; a revoke by
/// id would end the session and leave that state behind (and the host refuses
/// it anyway, 409 `current_session`).
///
/// 🔴 A FAILED READ IS SAID, NEVER DRAWN AS AN EMPTY LIST — "no other devices
/// are signed in" is the one answer a person would act on wrongly. It can be
/// tried again from the row that says so.
///
/// 🔴 READ ON DEMAND, NEVER ON MOUNT (review of #1129, finding 4). The host's
/// sessions limiter allows 5 calls a minute per account and the list SHARES it
/// with the revoke this section offers. Settings is a lazy list, so a read in
/// `initState` ran again every time the section scrolled back into view, and a
/// person who scrolled about a little found "Sign out this device" refused on
/// the one occasion it mattered. So the list is read when they ask for it,
/// once, and kept alive while Settings is open.
class DevicesSection extends StatefulWidget {
  const DevicesSection({required this.load, required this.revoke, super.key});

  /// Lists the account's sessions (`GET /v1/sessions`).
  final Future<core.Result<List<core.DeviceSession>>> Function() load;

  /// Signs ONE other session out (`DELETE /v1/sessions/:id`).
  final Future<core.Result<void>> Function(String id) revoke;

  static Key row(String id) => ValueKey<String>('settingsDevice-$id');
  static Key signOutButton(String id) =>
      ValueKey<String>('settingsDeviceSignOut-$id');
  static const Key unavailable = Key('settingsDevicesUnavailable');

  /// The row that reads the list — nothing is read until it is tapped.
  static const Key show = Key('settingsDevicesShow');

  @override
  State<DevicesSection> createState() => _DevicesSectionState();
}

class _DevicesSectionState extends State<DevicesSection>
    with AutomaticKeepAliveClientMixin<DevicesSection> {
  List<core.DeviceSession>? _rows;
  bool _failed = false;
  bool _loading = false;
  final Set<String> _busy = <String>{};

  /// Once asked for, the answer outlives scrolling out of the list's cache.
  @override
  bool get wantKeepAlive => _loading || _rows != null || _failed;

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _failed = false;
    });
    updateKeepAlive();
    final core.Result<List<core.DeviceSession>> r = await widget.load();
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (r is core.Ok<List<core.DeviceSession>>) {
        // This device first: it is the row a person looks for to orient.
        _rows = <core.DeviceSession>[
          ...r.value.where((core.DeviceSession s) => s.current),
          ...r.value.where((core.DeviceSession s) => !s.current),
        ];
        _failed = false;
      } else {
        _failed = true;
      }
    });
  }

  Future<void> _revoke(core.DeviceSession s) async {
    if (s.current || _busy.contains(s.id)) return;
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final String failed = context.chassisL10n.devicesSignOutFailed;
    setState(() => _busy.add(s.id));
    final core.Result<void> r = await widget.revoke(s.id);
    if (!mounted) return;
    setState(() {
      _busy.remove(s.id);
      if (r.isOk) {
        _rows = <core.DeviceSession>[
          for (final core.DeviceSession x in _rows ?? <core.DeviceSession>[])
            if (x.id != s.id) x,
        ];
      }
    });
    if (!r.isOk) messenger?.showSnackBar(SnackBar(content: Text(failed)));
  }

  static IconData _icon(String device) {
    final String d = device.toLowerCase();
    if (d.contains('iphone') || d.contains('android')) {
      return Icons.smartphone_outlined;
    }
    if (d.contains('ipad')) return Icons.tablet_outlined;
    return Icons.computer_outlined;
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final ChassisLocalizations l10n = context.chassisL10n;
    final MaterialLocalizations dates = MaterialLocalizations.of(context);
    final List<core.DeviceSession>? rows = _rows;
    return SettingsSection(
      title: l10n.devicesTitle,
      children: <Widget>[
        if (_failed)
          ListTile(
            key: DevicesSection.unavailable,
            leading: const Icon(Icons.error_outline),
            title: Text(l10n.devicesUnavailable),
            subtitle: Text(l10n.devicesRetry),
            onTap: _load,
          )
        else if (rows == null && !_loading)
          ListTile(
            key: DevicesSection.show,
            leading: const Icon(Icons.devices_outlined),
            title: Text(l10n.devicesShow),
            trailing: const Icon(Icons.chevron_right),
            onTap: _load,
          )
        else if (rows == null)
          const Padding(
            padding: EdgeInsets.all(AppSpacing.lg),
            child: LinearProgressIndicator(),
          )
        else
          for (final core.DeviceSession s in rows)
            ListTile(
              key: DevicesSection.row(s.id),
              leading: Icon(_icon(s.device)),
              title: Text(s.device),
              // The action sits UNDER the row's text, not in `trailing`: a
              // trailing button takes its width from the title, and at 200 %
              // text on a phone "Sign out this device" pushed the device name
              // off the row (measured in devices_section_test).
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    s.current
                        ? l10n.devicesThisDevice
                        : (s.lastActiveAt ?? s.createdAt) == null
                        ? ''
                        : l10n.devicesLastActive(
                            dates.formatMediumDate(
                              (s.lastActiveAt ?? s.createdAt)!.toLocal(),
                            ),
                          ),
                  ),
                  if (!s.current)
                    TextButton(
                      key: DevicesSection.signOutButton(s.id),
                      style: TextButton.styleFrom(padding: EdgeInsets.zero),
                      onPressed: _busy.contains(s.id) ? null : () => _revoke(s),
                      child: Text(l10n.devicesSignOutDevice),
                    ),
                ],
              ),
            ),
      ],
    );
  }
}
