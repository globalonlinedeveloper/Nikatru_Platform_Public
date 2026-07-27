// gen_pack_keypair.dart — generate the content-pack signing keypair. [OWNER_QUEUE S-3]
//
// Uses the SAME library the verifier uses (`cryptography` 2.9.0, chosen in
// pipeline C-6 because pointycastle 4.0.0 has no Ed25519), so the key it emits is
// guaranteed to be the shape Ed25519PackVerifier accepts: base64 of the RAW
// 32-byte public key, which is what `kContentPackPublicKeys` is documented to
// hold. Generating with some other tool and hoping the encoding matches is how
// you discover at signing time that it does not.
//
// ─────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE RUNNING — the ORDER of the surrounding steps matters, and two
// of them cannot be undone later:
//
//   1. Run this on an AIR-GAPPED machine if you mean the air-gap seriously.
//      This laptop is networked and syncs `.claude/` to Google Drive, so a seed
//      written here is a seed that has left the machine. `--print-seed` exists so
//      the private half never has to touch disk at all.
//   2. SHAMIR-SPLIT the seed and back the shares up offsite BEFORE importing to
//      any hardware token. A key generated ON a YubiKey is non-exportable and
//      therefore CANNOT be split — start there and you have permanently opted
//      out of loss protection. `key_id` (ADR 016) covers COMPROMISE; only the
//      split covers LOSS.
//   3. Paste the printed public key into `kContentPackPublicKeys` in
//      packages/core/lib/src/content/pack_verifier.dart as {'k1': '<key>'}.
//   4. Run a RESTORE DRILL from the shares before the first pack is signed. An
//      untested split is the same class of belief as an untested backup — and
//      this repo has already been bitten by exactly that.
//
// Losing the private key means no pack signed under that `key_id` can ever be
// updated. There is no recovery path. That is why steps 2 and 4 are not optional.
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage:
//   cd packages/core
//   dart run tool/gen_pack_keypair.dart --print-seed   # nothing touches disk
//   dart run tool/gen_pack_keypair.dart --out <path>   # seed written to <path>
//
// It lives in packages/core, not tooling/, because `cryptography` is declared
// there and nowhere else -- from the repo root the import does not resolve. A
// script that cannot run is worse than no script.
//
// The public key is always printed. The seed is printed OR written, never both,
// and never silently.
import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';

Future<void> main(List<String> args) async {
  final bool printSeed = args.contains('--print-seed');
  final int outIdx = args.indexOf('--out');
  final String? outPath = outIdx >= 0 && outIdx + 1 < args.length
      ? args[outIdx + 1]
      : null;

  if (printSeed == (outPath != null)) {
    stderr.writeln('Choose exactly one of --print-seed or --out <path>.');
    stderr.writeln('');
    stderr.writeln('  --print-seed  the private seed is shown once and never');
    stderr.writeln(
      '                written to disk. Preferred on a networked box.',
    );
    stderr.writeln(
      '  --out <path>  the seed is written to <path>. Do NOT point this',
    );
    stderr.writeln(
      '                inside .claude/ — that folder is uploaded to Drive.',
    );
    exitCode = 2;
    return;
  }

  if (outPath != null && outPath.replaceAll(r'\', '/').contains('/.claude/')) {
    stderr.writeln(
      'REFUSING: $outPath is inside .claude/, which is copied to Google',
    );
    stderr.writeln(
      'Drive by the backup. The private half of a signing key must not',
    );
    stderr.writeln(
      'be in the backup set — that is the circularity ADR 021 removed.',
    );
    exitCode = 2;
    return;
  }

  final Ed25519 algorithm = Ed25519();
  final SimpleKeyPair keyPair = await algorithm.newKeyPair();
  final SimplePublicKey publicKey = await keyPair.extractPublicKey();
  final List<int> seed = await keyPair.extractPrivateKeyBytes();

  final String pubB64 = base64.encode(publicKey.bytes);
  final String seedB64 = base64.encode(seed);

  // Prove the pair actually works before anyone commits the public half. A
  // public key pinned against a seed that cannot sign for it is a silent,
  // total failure at first pack load.
  final Signature sig = await algorithm.sign(<int>[1, 2, 3], keyPair: keyPair);
  final bool ok = await algorithm.verify(<int>[
    1,
    2,
    3,
  ], signature: Signature(sig.bytes, publicKey: publicKey));
  if (!ok) {
    stderr.writeln(
      'SELF-TEST FAILED: the generated pair did not verify. Do not use it.',
    );
    exitCode = 1;
    return;
  }

  stdout.writeln('ok  self-test — the generated pair signs and verifies');
  stdout.writeln('');
  stdout.writeln('PUBLIC key (${publicKey.bytes.length} bytes) — paste into');
  stdout.writeln('packages/core/lib/src/content/pack_verifier.dart:');
  stdout.writeln('');
  stdout.writeln(
    "    const Map<String, String> kContentPackPublicKeys = <String, String>{",
  );
  stdout.writeln("      'k1': '$pubB64',");
  stdout.writeln('    };');
  stdout.writeln('');

  if (printSeed) {
    stdout.writeln(
      'PRIVATE seed (${seed.length} bytes) — shown ONCE, not written anywhere:',
    );
    stdout.writeln('');
    stdout.writeln('    $seedB64');
    stdout.writeln('');
    stdout.writeln(
      'Shamir-split this NOW and back the shares up offsite before you',
    );
    stdout.writeln('close this terminal. It cannot be recovered.');
  } else {
    final File f = File(outPath!);
    await f.writeAsString('$seedB64\n', flush: true);
    stdout.writeln('PRIVATE seed written to: ${f.absolute.path}');
    stdout.writeln(
      'Shamir-split it, back the shares up offsite, then DELETE this file.',
    );
  }
}
