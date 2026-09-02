// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title RipStonks
/// @notice Inventory-backed $20 USDG packs for Robinhood Chain Stock Tokens.
/// @dev One request settles at a time so neither inventory mutation nor settlement
///      ordering can change the funded prize pool after a buyer commits.
contract StonkRips {
    struct Prize {
        address token;
        uint256 tokenAmount;
        uint256 declaredUsdMicros;
    }

    struct PackRequest {
        address buyer;
        bytes32 commitment;
        bytes32 fallbackSeed;
        uint256 entropyBlock;
        bool settled;
    }

    uint256 public constant packPrice = 20_000_000;
    uint256 public constant ENTROPY_DELAY = 2;
    address public constant canonicalUsdg = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    address public owner;
    address public treasury;
    bool public packsEnabled;
    uint256 public nextRequestId = 1;
    uint256 public activeRequestId;
    uint256 public inventoryValueUsdMicros;

    mapping(address => bool) public approvedStock;
    mapping(uint256 => PackRequest) public requests;
    Prize[] private inventory;
    uint256 private locked = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event TreasuryUpdated(address indexed treasury);
    event PacksEnabled(bool enabled);
    event StockApprovalUpdated(address indexed token, bool approved);
    event PrizeLoaded(uint256 indexed inventoryIndex, address indexed token, uint256 tokenAmount, uint256 declaredUsdMicros);
    event PrizeRemoved(address indexed token, uint256 tokenAmount, uint256 declaredUsdMicros, address indexed recipient);
    event PackRequested(uint256 indexed requestId, address indexed buyer, bytes32 indexed commitment, uint256 entropyBlock);
    event PrizeDelivered(uint256 indexed requestId, address indexed buyer, address indexed token, uint256 tokenAmount, uint256 declaredUsdMicros);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier nonReentrant() {
        require(locked == 1, "REENTRANT");
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address treasury_, address[] memory approvedStocks_) {
        require(treasury_ != address(0), "ZERO_TREASURY");
        owner = msg.sender;
        treasury = treasury_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit TreasuryUpdated(treasury_);
        for (uint256 i; i < approvedStocks_.length; ++i) {
            require(approvedStocks_[i] != address(0), "ZERO_STOCK");
            approvedStock[approvedStocks_[i]] = true;
            emit StockApprovalUpdated(approvedStocks_[i], true);
        }
    }

    function inventoryCount() external view returns (uint256) {
        return inventory.length;
    }

    function prizeAt(uint256 index) external view returns (Prize memory) {
        return inventory[index];
    }

    function maxPrizeUsdMicros() external view returns (uint256 maxValue) {
        for (uint256 i; i < inventory.length; ++i) {
            if (inventory[i].declaredUsdMicros > maxValue) maxValue = inventory[i].declaredUsdMicros;
        }
    }

    function setPacksEnabled(bool enabled) external onlyOwner {
        packsEnabled = enabled;
        emit PacksEnabled(enabled);
    }

    function setTreasury(address nextTreasury) external onlyOwner {
        require(nextTreasury != address(0), "ZERO_TREASURY");
        treasury = nextTreasury;
        emit TreasuryUpdated(nextTreasury);
    }

    function setApprovedStock(address token, bool approved) external onlyOwner {
        require(activeRequestId == 0, "REQUEST_ACTIVE");
        require(token != address(0), "ZERO_STOCK");
        approvedStock[token] = approved;
        emit StockApprovalUpdated(token, approved);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    function loadPrize(address token, uint256 tokenAmount, uint256 declaredUsdMicros) external onlyOwner nonReentrant {
        require(activeRequestId == 0, "REQUEST_ACTIVE");
        require(approvedStock[token], "STOCK_NOT_APPROVED");
        require(tokenAmount > 0 && declaredUsdMicros > 0, "INVALID_PRIZE");
        _safeTransferFrom(token, msg.sender, address(this), tokenAmount);
        inventory.push(Prize(token, tokenAmount, declaredUsdMicros));
        inventoryValueUsdMicros += declaredUsdMicros;
        emit PrizeLoaded(inventory.length - 1, token, tokenAmount, declaredUsdMicros);
    }

    function removePrize(uint256 index, address recipient) external onlyOwner nonReentrant {
        require(activeRequestId == 0, "REQUEST_ACTIVE");
        require(recipient != address(0), "ZERO_RECIPIENT");
        Prize memory prize = inventory[index];
        _removePrize(index);
        _safeTransfer(prize.token, recipient, prize.tokenAmount);
        emit PrizeRemoved(prize.token, prize.tokenAmount, prize.declaredUsdMicros, recipient);
    }

    function openPack(bytes32 commitment) external nonReentrant returns (uint256 requestId) {
        require(packsEnabled, "PACKS_DISABLED");
        require(activeRequestId == 0, "REQUEST_ACTIVE");
        require(inventory.length > 0, "NO_INVENTORY");
        require(commitment != bytes32(0), "ZERO_COMMITMENT");

        _safeTransferFrom(canonicalUsdg, msg.sender, address(this), packPrice);
        requestId = nextRequestId++;
        uint256 entropyBlock = block.number + ENTROPY_DELAY;
        requests[requestId] = PackRequest({
            buyer: msg.sender,
            commitment: commitment,
            fallbackSeed: keccak256(abi.encodePacked(block.prevrandao, blockhash(block.number - 1), commitment, msg.sender, requestId)),
            entropyBlock: entropyBlock,
            settled: false
        });
        activeRequestId = requestId;
        emit PackRequested(requestId, msg.sender, commitment, entropyBlock);
    }

    function settlePack(uint256 requestId) external nonReentrant returns (address token, uint256 tokenAmount, uint256 declaredUsdMicros) {
        require(activeRequestId == requestId, "NOT_ACTIVE_REQUEST");
        PackRequest storage request = requests[requestId];
        require(!request.settled, "ALREADY_SETTLED");
        require(block.number > request.entropyBlock, "ENTROPY_NOT_READY");

        bytes32 entropy = block.number <= request.entropyBlock + 256
            ? blockhash(request.entropyBlock)
            : request.fallbackSeed;
        require(entropy != bytes32(0), "NO_ENTROPY");

        uint256 index = uint256(keccak256(abi.encodePacked(request.commitment, entropy, request.buyer, requestId, address(this)))) % inventory.length;
        Prize memory prize = inventory[index];
        request.settled = true;
        activeRequestId = 0;
        _removePrize(index);

        _safeTransfer(canonicalUsdg, treasury, packPrice);
        _safeTransfer(prize.token, request.buyer, prize.tokenAmount);
        emit PrizeDelivered(requestId, request.buyer, prize.token, prize.tokenAmount, prize.declaredUsdMicros);
        return (prize.token, prize.tokenAmount, prize.declaredUsdMicros);
    }

    function _removePrize(uint256 index) internal {
        Prize memory prize = inventory[index];
        uint256 last = inventory.length - 1;
        if (index != last) inventory[index] = inventory[last];
        inventory.pop();
        inventoryValueUsdMicros -= prize.declaredUsdMicros;
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }
}
