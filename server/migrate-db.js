import mongoose from 'mongoose';

const localUri = 'mongodb://127.0.0.1:27017/college_voting';
const remoteUri = 'mongodb+srv://pritamsklohar:Psk264245@diya-fashion.dte6bx4.mongodb.net/college-council-election?appName=diya-fashion';

async function migrate() {
  console.log('Connecting to local database...');
  const localConn = await mongoose.createConnection(localUri).asPromise();
  const localDb = localConn.db;

  console.log('Connecting to remote database...');
  const remoteConn = await mongoose.createConnection(remoteUri).asPromise();
  const remoteDb = remoteConn.db;

  const collections = await localDb.listCollections().toArray();
  
  for (const collInfo of collections) {
    const collName = collInfo.name;
    console.log(`Migrating collection: ${collName}...`);
    
    const localCollection = localDb.collection(collName);
    const remoteCollection = remoteDb.collection(collName);
    
    const docs = await localCollection.find({}).toArray();
    
    if (docs.length > 0) {
      await remoteCollection.deleteMany({});
      await remoteCollection.insertMany(docs);
      console.log(` -> Copied ${docs.length} documents.`);
    } else {
      console.log(` -> No documents to copy.`);
    }
  }

  console.log('Migration complete!');
  await localConn.close();
  await remoteConn.close();
}

migrate().catch(console.error);
