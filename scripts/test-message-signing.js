const { signMessage, verifyMessage } = require('../src/lib/message');

console.log('=== Testing Message Signing ===\n');

const testMessage = 'Hello Bitcoin World!';
const privateKeyWIF = process.env.TEST_PRIVATE_KEY_WIF;
if (!privateKeyWIF) {
  console.error('Set TEST_PRIVATE_KEY_WIF environment variable to run this test.');
  process.exit(1);
}

// Sign the message
console.log('1. Signing message...');
const signResult = signMessage(testMessage, privateKeyWIF);
console.log('Sign Result:', JSON.stringify(signResult, null, 2));

// Verify the message
console.log('\n2. Verifying signature...');
const isValid = verifyMessage(testMessage, signResult.address, signResult.signature);
console.log('Verification Result:', isValid ? 'VALID' : 'INVALID');

// Test with wrong message
console.log('\n3. Testing with wrong message...');
const isValid2 = verifyMessage('Different message', signResult.address, signResult.signature);
console.log('Wrong message verification:', isValid2 ? 'FALSE POSITIVE' : 'Correctly rejected');

// Test with wrong address
console.log('\n4. Testing with wrong address...');
const isValid3 = verifyMessage(testMessage, 'tb1qwrong1111111111111111111111111111111', signResult.signature);
console.log('Wrong address verification:', isValid3 ? 'FALSE POSITIVE' : 'Correctly rejected');

console.log('\n=== Test Complete ===');
