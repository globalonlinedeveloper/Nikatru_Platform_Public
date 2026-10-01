import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

void main() {
  test('a chosen file comes back decoded, with its name', () async {
    List<String>? asked;
    final SelectorFileImporter i = SelectorFileImporter(
      canPick: true,
      open: (List<String> ext) async {
        asked = ext;
        return (name: 'subs.csv', bytes: 'name,price\nA,1\n'.codeUnits);
      },
    );
    final core.ImportedFile? f = await i.pick(extensions: <String>['csv']);
    expect(asked, <String>['csv']);
    expect(f?.name, 'subs.csv');
    expect(f?.kind, core.ImportInputKind.csv);
  });

  test('a dismissed dialog is null, not an error', () async {
    final SelectorFileImporter i = SelectorFileImporter(
      canPick: true,
      open: (_) async => null,
    );
    expect(await i.pick(extensions: <String>['csv']), isNull);
  });

  test('a throwing plugin is null, never a crash', () async {
    final SelectorFileImporter i = SelectorFileImporter(
      canPick: true,
      open: (_) => throw StateError('MissingPluginException'),
    );
    expect(await i.pick(extensions: <String>['csv']), isNull);
  });

  test('where no picker is linked, nothing is opened', () async {
    bool opened = false;
    final SelectorFileImporter i = SelectorFileImporter(
      canPick: false,
      open: (_) async {
        opened = true;
        return null;
      },
    );
    expect(i.canPick, isFalse);
    expect(await i.pick(extensions: <String>['csv']), isNull);
    expect(opened, isFalse);
  });
}
