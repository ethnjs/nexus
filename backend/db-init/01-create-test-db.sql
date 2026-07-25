-- Runs automatically on first init of a fresh postgres_data volume
-- (docker-entrypoint-initdb.d convention). Creates the dedicated test
-- database so `pytest` works without a manual `createdb` step, even
-- after the volume has been dropped and recreated.
CREATE DATABASE nexus_test;
