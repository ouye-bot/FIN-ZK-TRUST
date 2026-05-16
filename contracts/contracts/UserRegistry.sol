pragma solidity ^0.8.0;

contract UserRegistry {
    struct UserRecord {
        string pkHash;
        uint256 createdAt;
        uint256 updatedAt;
        bool exists;
    }

    mapping(address => UserRecord) private users;
    address[] public userIndex;

    event UserRegistered(address indexed usr, string pkHash, uint256 time);
    event UserUpdated(address indexed usr, string oldHash, string newHash, uint256 time);

    function register(string memory pkHash) public {
        require(!users[msg.sender].exists, "Already registered, use update");
        users[msg.sender] = UserRecord(pkHash, block.timestamp, block.timestamp, true);
        userIndex.push(msg.sender);
        emit UserRegistered(msg.sender, pkHash, block.timestamp);
    }

    function update(string memory newPkHash) public {
        require(users[msg.sender].exists, "Not registered yet");
        string memory oldHash = users[msg.sender].pkHash;
        users[msg.sender].pkHash = newPkHash;
        users[msg.sender].updatedAt = block.timestamp;
        emit UserUpdated(msg.sender, oldHash, newPkHash, block.timestamp);
    }

    function getUser(address usr) public view returns (
        string memory pkHash,
        uint256 createdAt,
        uint256 updatedAt
    ) {
        UserRecord memory u = users[usr];
        require(u.exists, "Not found");
        return (u.pkHash, u.createdAt, u.updatedAt);
    }

    function getTotalUsers() public view returns (uint256) {
        return userIndex.length;
    }
}