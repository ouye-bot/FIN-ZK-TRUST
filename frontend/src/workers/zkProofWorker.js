/* eslint-disable no-restricted-globals */
import { groth16 } from 'snarkjs';
import { sm3 } from 'sm-crypto';

let wasmUrl = null;
let zkeyUrl = null;
let isInitialized = false;

function generateSM3Hash(data) {
  return sm3(String(data));
}

self.onmessage = async (e) => {
  const { type, wasmUrl: initWasmUrl, zkeyUrl: initZkeyUrl, input, requestId } = e.data;

  switch (type) {
    case 'INIT':
      try {
        wasmUrl = initWasmUrl;
        zkeyUrl = initZkeyUrl;
        isInitialized = true;
        console.log('[Worker] Initialized with URLs:', { wasmUrl, zkeyUrl });
        self.postMessage({ type: 'INIT_COMPLETE', requestId });
      } catch (error) {
        console.error('[Worker] INIT error:', error.message);
        self.postMessage({ type: 'ERROR', error: error.message, requestId });
      }
      break;

    case 'GENERATE_PROOF':
      if (!isInitialized) {
        self.postMessage({
          type: 'ERROR',
          error: 'Worker not initialized. Call INIT first.',
          requestId
        });
        return;
      }

      try {
        const creditScore = Number(input.creditScore);
        const threshold = Number(input.threshold);

        if (isNaN(creditScore) || isNaN(threshold)) {
          throw new Error('Invalid input: creditScore and threshold must be numbers');
        }

        const hashedCreditScore = parseInt(
          generateSM3Hash(creditScore.toString()).substring(0, 8), 16
        );
        const hashedThreshold = parseInt(
          generateSM3Hash(threshold.toString()).substring(0, 8), 16
        );

        const proofInput = {
          creditScore: hashedCreditScore,
          threshold: hashedThreshold
        };

        console.log('[Worker] Generating proof, input:', proofInput);
        console.log('[Worker] WASM URL:', wasmUrl);
        console.log('[Worker] ZKEY URL:', zkeyUrl);

        const { proof, publicSignals } = await groth16.fullProve(
          proofInput,
          wasmUrl,
          zkeyUrl
        );

        console.log('[Worker] Proof generated successfully');
        console.log('[Worker] publicSignals:', publicSignals);

        self.postMessage({
          type: 'PROOF_COMPLETE',
          proof,
          publicSignals,
          requestId
        });
      } catch (error) {
        console.error('[Worker] Proof generation failed:', error.message);
        console.error('[Worker] Stack:', error.stack);
        self.postMessage({
          type: 'ERROR',
          error: error.message || 'Proof generation failed',
          requestId
        });
      }
      break;

    default:
      self.postMessage({
        type: 'ERROR',
        error: `Unknown message type: ${type}`,
        requestId
      });
  }
};
