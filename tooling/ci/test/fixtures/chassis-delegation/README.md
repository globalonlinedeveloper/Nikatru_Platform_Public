# `chassis-delegation` fixtures

The **shape chassis step 4 produces**, in files, so that six suites can build it
without six hand-written copies drifting apart.

[ADR 066] step 4 does not delete a brick screen. It empties one: the body moves
into `package:nikatru_chassis_screens` and an **adapter** is left at the same
path — same file, same route, same class name, none of the body. Thirteen guards
pin that path and judge a property on the file at it (a `Semantics(`, a width
test, a `caps.<field>` gate, a seam call, a key constant), and read at the
adapter alone every one of them reports the property GONE.

So each guard resolves the adapter's single `package:nikatru_chassis_screens`
import to the package file and judges the property THERE — one level, exactly
like the design-system barrel resolution that already exists in
`assert-a11y-coverage.mjs`.

## What is in here, and why it is source and not a string in a test

| file | what it is |
|---|---|
| `adapter_screen.dart.tpl` | the adapter: one chassis import, one class, no body |
| `chassis_widget.dart.tpl` | the package widget, carrying every property (Semantics, width, a `caps.` gate) |
| `chassis_widget_bare.dart.tpl` | the same widget with the property REMOVED — the mutation |
| `chassis_barrel.dart.tpl` | a barrel that re-exports the widget, for the one-level expansion case |

`.tpl` rather than `.dart` deliberately: these are not part of any Dart
workspace, and a stray `.dart` under `tooling/` is picked up by tree scans that
have no business reading a fixture. Each carries `__CLASS__` and `__IMPORT__`
placeholders the tests substitute.

**The refusals are the point, not the happy path.** A delegation that resolves
to nothing on disk, a file with two different chassis imports, and a chassis
package that is not in the scan's domain at all are each COVERAGE LOST — because
each of them means the property is now judged NOWHERE by a guard that would
otherwise print ok.
