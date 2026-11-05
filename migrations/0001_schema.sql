CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  telegram_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  login TEXT UNIQUE,
  key_hash TEXT,
  CHECK ((telegram_id IS NOT NULL AND login IS NULL AND key_hash IS NULL)
      OR (telegram_id IS NULL AND login IS NOT NULL AND key_hash IS NOT NULL))
);
CREATE TABLE classes (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL);
CREATE TABLE memberships (
  class_id TEXT NOT NULL REFERENCES classes(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('student','teacher')),
  status TEXT NOT NULL CHECK(status IN ('pending','active')),
  PRIMARY KEY(class_id,user_id)
);
CREATE TABLE quizzes (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  intro TEXT NOT NULL
);
CREATE TABLE questions (
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  number INTEGER NOT NULL CHECK(number > 0),
  prompt TEXT NOT NULL,
  options TEXT NOT NULL CHECK(json_valid(options) AND json_array_length(options)=4),
  correct INTEGER NOT NULL CHECK(correct BETWEEN 0 AND 3),
  explanation TEXT NOT NULL,
  PRIMARY KEY(quiz_id,number)
);
CREATE TABLE rounds (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id),
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  closed_at TEXT
);
CREATE TABLE attempts (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score >= 0),
  answers TEXT NOT NULL CHECK(json_valid(answers) AND json_array_length(answers)>0
    AND score <= json_array_length(answers)),
  PRIMARY KEY(round_id,user_id)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL
);
CREATE INDEX memberships_by_user ON memberships(user_id,status,role);
CREATE INDEX sessions_by_expiry ON sessions(expires);
