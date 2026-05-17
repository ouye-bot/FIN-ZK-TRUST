const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Compile the circuit
console.log('Compiling circuit...');
execSync('circom credit.circom -r build/credit.r1cs -w build/credit.wasm -s build/credit.sym', { stdio: 'inherit' });

// Generate the verification key
console.log('Generating verification key...');
execSync('snarkjs groth16 setup build/credit.r1cs pot12_final.ptau build/credit_final.zkey', { stdio: 'inherit' });

// Export the verification key
console.log('Exporting verification key...');
execSync('snarkjs zkey export verificationkey build/credit_final.zkey build/verification_key.json', { stdio: 'inherit' });

// Export the solidity verifier
console.log('Exporting solidity verifier...');
execSync('snarkjs zkey export solidityverifier build/credit_final.zkey build/Verifier.sol', { stdio: 'inherit' });

console.log('Compilation completed successfully!'); 