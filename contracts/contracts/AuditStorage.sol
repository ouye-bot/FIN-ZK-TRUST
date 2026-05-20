// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract AuditStorage {
    struct AuditRecord {
        uint256 timestamp;
        address submitter;
        string operationType;
        string userId;
    }

    address public owner;
    mapping(address => bool) public authorizedOperators;

    mapping(bytes32 => AuditRecord) public records;
    bytes32[] public recordIndex;

    event AuditStored(bytes32 indexed hashValue, uint256 timestamp, string operationType, string userId);
    event OperatorAuthorized(address indexed operator);
    event OperatorRevoked(address indexed operator);

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
        require(op != address(0), "Zero address");
        authorizedOperators[op] = true;
        emit OperatorAuthorized(op);
    }

    function revokeOperator(address op) external onlyOwner {
        authorizedOperators[op] = false;
        emit OperatorRevoked(op);
    }

    function storeAuditHash(bytes32 hashValue, uint256 timestamp, string memory operationType, string memory userId) public onlyAuthorized returns (bool) {
        require(records[hashValue].timestamp == 0, "Hash already exists");
        records[hashValue] = AuditRecord(timestamp, msg.sender, operationType, userId);
        recordIndex.push(hashValue);
        emit AuditStored(hashValue, timestamp, operationType, userId);
        return true;
    }

    function getTotalRecords() public view returns (uint256) {
        return recordIndex.length;
    }

    function getRecordByHash(bytes32 hashValue) public view returns (
        uint256 timestamp,
        address submitter,
        string memory operationType,
        string memory userId
    ) {
        AuditRecord memory r = records[hashValue];
        require(r.timestamp != 0, "Record not found");
        return (r.timestamp, r.submitter, r.operationType, r.userId);
    }

    function getRecordByIndex(uint256 index) public view returns (
        bytes32 hashValue,
        uint256 timestamp,
        address submitter,
        string memory operationType,
        string memory userId
    ) {
        require(index < recordIndex.length, "Index out of bounds");
        bytes32 key = recordIndex[index];
        AuditRecord memory r = records[key];
        return (key, r.timestamp, r.submitter, r.operationType, r.userId);
    }
}
