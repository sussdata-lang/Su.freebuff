-- قوالب المراسلات: نصوص جاهزة تُعبَّأ في نموذج المستند (تدعم {{date}} و{{unit}} و{{name}})
CREATE TABLE corr_templates (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'عام',
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'parallel' CHECK (mode IN ('sequential','parallel')),
  active INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
