// A barrel over the widget. The resolver expands ONE level through these
// `export` lines and no further — a barrel re-exporting a barrel is not a shape
// this tree has, and a walk nobody bounded is a walk that eventually reads the
// whole repository.
export '__EXPORT__';
