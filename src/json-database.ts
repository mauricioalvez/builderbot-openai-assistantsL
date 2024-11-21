import { JsonFileDB } from '@builderbot/database-json';

export type IDatabase = typeof JsonFileDB
export const adapterDB = new JsonFileDB('./db.json');
