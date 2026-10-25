-- نسخة إلى: مطّلعون على المستند دون أن يكونوا معتمدين
CREATE TABLE corr_cc (
  doc_id INTEGER NOT NULL REFERENCES corr_docs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (doc_id, user_id)
);
CREATE INDEX corr_cc_user ON corr_cc(user_id);
