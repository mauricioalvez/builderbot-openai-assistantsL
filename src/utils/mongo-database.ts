import { MongoDB } from '@builderbot/database-mongo'

export type IDatabase = typeof MongoDB
export const adapterDB = new MongoDB({
    dbUri: MONGO_DB_URI,
    dbName: MONGO_DB_NAME,
})
