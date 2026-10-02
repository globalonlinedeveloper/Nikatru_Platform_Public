import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

void main() {
  test(
    'sha256Hex is the FIPS 180-2 digest of the UTF-8 bytes, lower-case hex',
    () {
      expect(
        sha256Hex('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
      expect(sha256Hex('é'), isNot(sha256Hex('e')));
    },
  );
}
