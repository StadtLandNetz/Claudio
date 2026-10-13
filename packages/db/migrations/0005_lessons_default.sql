-- Rows that existed before the lessons column got JSON null; the app expects a list.
UPDATE `repos` SET `lessons` = JSON_ARRAY() WHERE `lessons` IS NULL OR JSON_TYPE(`lessons`) = 'NULL';
