import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let isInitialized = false;

/**
 * Initialize Firebase Admin SDK
 */
const initializeFirebase = () => {
  if (isInitialized) {
    console.log('✅ Firebase already initialized');
    return true;
  }

  try {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║       🔥 FIREBASE ADMIN SDK INITIALIZATION           ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // ═══════════════════════════════════════════════════════════════
    // METHOD 1: ENVIRONMENT VARIABLES (PRODUCTION - RENDER)
    // ═══════════════════════════════════════════════════════════════
    console.log('🔍 Checking for environment variables...');
    
    const hasProjectId = !!process.env.FIREBASE_PROJECT_ID;
    const hasClientEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
    const hasPrivateKey = !!process.env.FIREBASE_PRIVATE_KEY;
    
    console.log('   FIREBASE_PROJECT_ID:', hasProjectId ? '✅ Present' : '❌ Missing');
    console.log('   FIREBASE_CLIENT_EMAIL:', hasClientEmail ? '✅ Present' : '❌ Missing');
    console.log('   FIREBASE_PRIVATE_KEY:', hasPrivateKey ? '✅ Present' : '❌ Missing');

    if (hasProjectId && hasClientEmail && hasPrivateKey) {
      console.log('\n📋 Using ENVIRONMENT VARIABLES for Firebase Admin');
      
      const projectId = process.env.FIREBASE_PROJECT_ID.trim();
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL.trim();
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;

      console.log('\n📊 Environment Variable Details:');
      console.log('   Project ID:', projectId);
      console.log('   Client Email:', clientEmail);
      console.log('   Private Key Length:', privateKey.length, 'characters');
      console.log('   Private Key Preview:', privateKey.substring(0, 50) + '...');

      // CRITICAL: Handle escaped newlines
      console.log('\n🔧 Processing private key...');
      const originalLength = privateKey.length;
      
      // Remove quotes if present
      if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
        console.log('   Removed surrounding quotes');
      }
      
      // Replace escaped newlines with actual newlines
      if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
        console.log('   Converted \\n to actual newlines');
      }
      
      console.log('   Original length:', originalLength);
      console.log('   Processed length:', privateKey.length);
      console.log('   Starts with:', privateKey.substring(0, 30));
      console.log('   Ends with:', privateKey.substring(privateKey.length - 30));

      // Validate private key format
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        console.error('\n❌ INVALID PRIVATE KEY FORMAT!');
        console.error('   Private key must start with: -----BEGIN PRIVATE KEY-----');
        console.error('   Current start:', privateKey.substring(0, 50));
        return false;
      }

      if (!privateKey.includes('-----END PRIVATE KEY-----')) {
        console.error('\n❌ INVALID PRIVATE KEY FORMAT!');
        console.error('   Private key must end with: -----END PRIVATE KEY-----');
        console.error('   Current end:', privateKey.substring(privateKey.length - 50));
        return false;
      }

      console.log('\n🔥 Initializing Firebase Admin with credentials...');

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: privateKey
        })
      });

      isInitialized = true;
      
      console.log('\n╔════════════════════════════════════════════════════════╗');
      console.log('║       ✅ FIREBASE INITIALIZED FROM ENV VARS!          ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log('║  Project:', projectId.padEnd(42), '║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      
      return true;
    }

    // ═══════════════════════════════════════════════════════════════
    // METHOD 2: SERVICE ACCOUNT JSON FILE (LOCAL DEVELOPMENT)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n📋 Environment variables not found.');
    console.log('🔍 Checking for serviceAccountKey.json file...');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 
                                path.join(__dirname, 'serviceAccountKey.json');

    console.log('   Path:', serviceAccountPath);

    if (!fs.existsSync(serviceAccountPath)) {
      console.error('\n❌ serviceAccountKey.json NOT FOUND!');
      console.error('   Looked at:', serviceAccountPath);
      
      console.log('\n╔════════════════════════════════════════════════════════╗');
      console.log('║       ❌ FIREBASE INITIALIZATION FAILED               ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log('║  NO CREDENTIALS FOUND                                  ║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      
      console.log('📋 SOLUTION FOR RENDER:');
      console.log('   Set these environment variables in Render dashboard:\n');
      console.log('   FIREBASE_PROJECT_ID=your-project-id');
      console.log('   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com');
      console.log('   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nMIIE...\\n-----END PRIVATE KEY-----\\n"\n');
      console.log('📋 Get credentials from:');
      console.log('   https://console.firebase.google.com');
      console.log('   → Project Settings → Service Accounts → Generate New Private Key\n');
      
      return false;
    }

    console.log('   ✅ File found, reading...');
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    
    console.log('   Project ID:', serviceAccount.project_id || '(missing)');
    console.log('   Client Email:', serviceAccount.client_email || '(missing)');
    console.log('   Private Key:', serviceAccount.private_key ? 'Present' : 'Missing');

    if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
      console.error('\n❌ Invalid service account file - missing required fields');
      return false;
    }

    console.log('\n🔥 Initializing Firebase Admin from file...');

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    isInitialized = true;
    
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║       ✅ FIREBASE INITIALIZED FROM FILE!              ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log('║  Project:', serviceAccount.project_id.padEnd(42), '║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    return true;

  } catch (error) {
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║       ❌ FIREBASE INITIALIZATION ERROR                ║');
    console.error('╚════════════════════════════════════════════════════════╝\n');
    console.error('Error Type:', error.constructor.name);
    console.error('Error Code:', error.code || '(none)');
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('\n');
    
    return false;
  }
};

/**

* Check Firebase status
  */
  const isFirebaseInitialized = () => isInitialized;

/**

* Safe admin getter
  */
  const getAdmin = () => {
  if (!isInitialized) {
  throw new Error('Firebase not initialized');
  }
  return admin;
  };

/**
 * Verify a Firebase ID token (used by auth middleware).
 */
export const verifyIdToken = async (token) => {
  if (!isInitialized) {
    throw new Error('Firebase not initialized');
  }
  try {
    return await admin.auth().verifyIdToken(token);
  } catch (error) {
    console.error('❌ Token verification failed:', error.message);
    throw error;
  }
};

export { admin, initializeFirebase, isFirebaseInitialized, getAdmin };
