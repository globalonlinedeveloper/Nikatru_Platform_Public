/// A persisted value held by a state notifier: the plumbing the chassis's
/// persisted controllers repeat — hydrate in the background, never clobber a
/// live choice, apply in memory first, persist best-effort ([ADR 072] D1.4).
///
/// DOMAIN-FREE BY CONSTRUCTION. It is handed plain callbacks: how to [open]
/// the store, how to [read] and [write] one raw string in it, how to [decode]
/// and [encode] that string, and how to [apply] a value to the caller's state.
/// It knows no store, no key and no notifier, which is what lets it live in a
/// package that may not see a `nikatru_*` type. The caller keeps its key and
/// its codec, and the store call that names the key stays at the call site.
///
/// 🔴 [mounted] IS ASKED AFTER EVERY AWAIT, BEFORE ANY CALLBACK TOUCHES THE
/// OWNER. Riverpod 3 THROWS on a Ref or `state` used after its provider is
/// disposed (2.x ignored the write), and a read that lands after a container
/// is torn down would otherwise throw from [apply], be caught, and throw again
/// from [onUnreadable] — uncaught, out of a hydration nobody awaits.
///
/// Every failure is swallowed, never thrown: nothing here may take an app down
/// at launch. An unreadable store keeps the caller's default, or runs
/// [onUnreadable] for a caller whose default blocks a decision (null "not
/// known yet" must resolve, or the router waits forever). A failed write keeps
/// the value in memory, so the choice only resets next launch.
class PersistedValue<S, T> {
  /// See the class doc; each callback belongs to the caller.
  PersistedValue({
    required this.open,
    required this.read,
    required this.write,
    required this.decode,
    required this.encode,
    required this.apply,
    required this.mounted,
    this.onUnreadable,
  });

  /// Opens the store. Awaited on every read and write, never cached here.
  final Future<S> Function() open;

  /// The raw stored string, or null when nothing is stored.
  final Future<String?> Function(S store) read;

  /// Stores the raw string.
  final Future<void> Function(S store, String raw) write;

  /// The value a raw string (null when absent) stands for. A throw reads as
  /// an unreadable store.
  final T Function(String? raw) decode;

  /// The raw string [write] stores for a value.
  final String Function(T value) encode;

  /// Puts a value into the caller's state.
  final void Function(T value) apply;

  /// Whether the owner can still take a value (a notifier: `ref.mounted`).
  /// False drops a late read or write instead of applying it.
  final bool Function() mounted;

  /// Runs when the store cannot be read and nothing has been [set].
  final void Function()? onUnreadable;

  /// 🔴 LOAD-BEARING, and found by the chassis property test on its very first
  /// run. Hydration is async, so a user tapping Dark during launch could be
  /// overtaken by the disk read completing afterwards and resetting them to the
  /// stored value — the setting visibly snapping back. Hydration must never
  /// overwrite a live choice, so [set] raises this and [hydrate] yields to it.
  bool _chosen = false;

  Future<void>? _hydrating;

  /// Reads the stored value and applies it, unless [set] got there first.
  /// Deliberately not awaited by a caller's `build`: first paint must never
  /// block on disk. Never throws.
  Future<void> hydrate() => _hydrating = _hydrate();

  /// 🔴 A COUNTER'S EVERY MUTATOR AWAITS THIS, and it is not tidiness — the
  /// property test caught the bug. [set]'s guard is right for a CHOICE: last
  /// writer wins, and the user is the last writer. For a counter that rule
  /// loses data: a launch counted from the first frame while hydration was in
  /// flight incremented the EMPTY default, then the read landed and overwrote
  /// it with the stored count, so the launch went uncounted. Never throws.
  ///
  /// Answers [mounted] once hydration is done: a caller that gets false has
  /// no owner left to read or write, and stops.
  Future<bool> ensureHydrated() async {
    await _hydrating;
    return mounted();
  }

  Future<void> _hydrate() async {
    try {
      final T stored = decode(await read(await open()));
      if (_chosen || !mounted()) return; // the user got there first
      apply(stored);
    } catch (_) {
      if (!_chosen && mounted()) onUnreadable?.call();
    }
  }

  /// A user's choice: applied in memory FIRST, so the UI responds at once even
  /// if the write is slow or fails, then written best-effort.
  Future<void> set(T value) {
    _chosen = true;
    return persist(value);
  }

  /// A counter's write, made after [ensureHydrated] rather than as a choice:
  /// applied in memory, then written best-effort. It marks nothing.
  Future<void> persist(T value) async {
    if (!mounted()) return;
    apply(value);
    try {
      await write(await open(), encode(value));
    } catch (_) {
      // Best-effort: a failed write only means the value resets next launch.
    }
  }
}
