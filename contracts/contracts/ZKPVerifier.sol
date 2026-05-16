pragma solidity ^0.8.0;

contract ZKPVerifier {
    struct ProofResult {
        bool valid;
        uint256 timestamp;
        address submitter;
        string proofHash;
    }

    mapping(bytes32 => ProofResult) public verifiedProofs;

    event ProofVerified(bytes32 indexed proofId, bool valid, uint256 timestamp);

    function recordProofResult(bytes32 proofId, bool valid, string memory proofHash) public returns (bool) {
        require(verifiedProofs[proofId].timestamp == 0, "Proof already recorded");
        verifiedProofs[proofId] = ProofResult(valid, block.timestamp, msg.sender, proofHash);
        emit ProofVerified(proofId, valid, block.timestamp);
        return true;
    }

    function getProofResult(bytes32 proofId) public view returns (bool, uint256, address, string memory) {
        ProofResult memory r = verifiedProofs[proofId];
        require(r.timestamp != 0, "Proof not found");
        return (r.valid, r.timestamp, r.submitter, r.proofHash);
    }
}