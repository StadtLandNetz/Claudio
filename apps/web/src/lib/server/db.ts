import './env.js';
import { getDb } from '@claudio/db';

export const db = () => getDb();
