// Generates a VAPID key pair for web push.
// Usage: npm run vapid
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('');
console.log('VAPID keys generated. Store these as environment variables.');
console.log('');
console.log('Server (Railway):');
console.log(`  VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`  VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('  VAPID_SUBJECT=mailto:you@example.com');
console.log('');
console.log('The client fetches the public key from the API, so the client does not');
console.log('need its own copy. Keep the private key secret.');
console.log('');
