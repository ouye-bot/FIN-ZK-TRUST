pragma solidity ^0.8.0;

contract AuditStorage {
    struct AuditRecord {
        uint256 timestamp;
        address submitter;
        string operationType;
        string userId;
    }

    mapping(string => AuditRecord) public records;
    string[] public recordIndex;

    event AuditStored(string hashValue, uint256 timestamp, string operationType, string userId);

    function storeAuditHash(string memory hashValue, uint256 timestamp, string memory operationType, string memory userId) public returns (bool) {
        require(records[hashValue].timestamp == 0, "Hash already exists");
        records[hashValue] = AuditRecord(timestamp, msg.sender, operationType, userId);
        recordIndex.push(hashValue);
        emit AuditStored(hashValue, timestamp, operationType, userId);
        return true;
    }

    function getTotalRecords() public view returns (uint256) {
        return recordIndex.length;
    }

    function getRecordByHash(string memory hashValue) public view returns (
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
        string memory hashValue,
        uint256 timestamp,
        address submitter,
        string memory operationType,
        string memory userId
    ) {
        require(index < recordIndex.length, "Index out of bounds");
        string memory key = recordIndex[index];
        AuditRecord memory r = records[key];
        return (key, r.timestamp, r.submitter, r.operationType, r.userId);
    }
}