// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ZKPVerifier {
    struct ProofResult {
        bool valid;
        uint256 timestamp;
        address submitter;
        string proofHash;
        bool chainVerified;
        bool chainValid;
    }

    address public owner;
    mapping(address => bool) public authorizedOperators;

    mapping(bytes32 => ProofResult) public verifiedProofs;

    event ProofVerified(bytes32 indexed proofId, bool valid, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner || authorizedOperators[msg.sender], "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function authorizeOperator(address op) external onlyOwner {
        authorizedOperators[op] = true;
    }

    function revokeOperator(address op) external onlyOwner {
        authorizedOperators[op] = false;
    }

    function recordProofResult(bytes32 proofId, bool valid, string memory proofHash) public onlyAuthorized returns (bool) {
        require(verifiedProofs[proofId].timestamp == 0, "Proof already recorded");
        verifiedProofs[proofId] = ProofResult(valid, block.timestamp, msg.sender, proofHash, false, false);
        emit ProofVerified(proofId, valid, block.timestamp);
        return true;
    }

    function updateChainStatus(bytes32 proofId, bool chainValid) public onlyAuthorized returns (bool) {
        require(verifiedProofs[proofId].timestamp != 0, "Proof not found");
        verifiedProofs[proofId].chainVerified = true;
        verifiedProofs[proofId].chainValid = chainValid;
        return true;
    }

    function getProofResult(bytes32 proofId) public view returns (bool, uint256, address, string memory, bool, bool) {
        ProofResult memory r = verifiedProofs[proofId];
        require(r.timestamp != 0, "Proof not found");
        return (r.valid, r.timestamp, r.submitter, r.proofHash, r.chainVerified, r.chainValid);
    }
}
