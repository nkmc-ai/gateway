-- Add auth_mode column for nkmc-jwt proxy authentication
ALTER TABLE services ADD COLUMN auth_mode TEXT;
