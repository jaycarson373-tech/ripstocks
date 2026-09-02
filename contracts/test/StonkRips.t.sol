// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StonkRips} from "../StonkRips.sol";

interface Vm {
    function roll(uint256) external;
    function etch(address, bytes calldata) external;
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (from != msg.sender) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract StonkRipsTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address private constant TREASURY = address(0xBEEF);

    StonkRips private packs;
    MockToken private stockA;
    MockToken private stockB;

    function setUp() public {
        MockToken usdgImplementation = new MockToken();
        vm.etch(USDG, address(usdgImplementation).code);
        stockA = new MockToken();
        stockB = new MockToken();
        address[] memory approved = new address[](2);
        approved[0] = address(stockA);
        approved[1] = address(stockB);
        packs = new StonkRips(TREASURY, approved);
        MockToken(USDG).mint(address(this), 100_000_000);
        stockA.mint(address(this), 1 ether);
        stockB.mint(address(this), 1 ether);
        MockToken(USDG).approve(address(packs), type(uint256).max);
        stockA.approve(address(packs), type(uint256).max);
        stockB.approve(address(packs), type(uint256).max);
    }

    function testPacksDefaultDisabled() public {
        packs.loadPrize(address(stockA), 1 ether, 5_000_000);
        (bool ok,) = address(packs).call(abi.encodeCall(packs.openPack, (keccak256("commit"))));
        require(!ok, "packs must default disabled");
    }

    function testPaidPackSettlesOneFundedPrize() public {
        packs.loadPrize(address(stockA), 1 ether, 5_000_000);
        packs.loadPrize(address(stockB), 1 ether, 100_000_000);
        packs.setPacksEnabled(true);
        uint256 requestId = packs.openPack(keccak256("buyer commitment"));
        require(packs.activeRequestId() == requestId, "request not active");
        vm.roll(block.number + 3);
        packs.settlePack(requestId);
        require(MockToken(USDG).balanceOf(TREASURY) == 20_000_000, "wrong payment");
        require(packs.inventoryCount() == 1, "wrong inventory count");
        require(stockA.balanceOf(address(this)) + stockB.balanceOf(address(this)) == 1 ether, "exactly one prize must remain outside buyer balance");
        require(packs.activeRequestId() == 0, "request still active");
    }

    function testCannotMutateInventoryDuringActiveRequest() public {
        packs.loadPrize(address(stockA), 1 ether, 5_000_000);
        packs.setPacksEnabled(true);
        packs.openPack(keccak256("commit"));
        (bool ok,) = address(packs).call(abi.encodeCall(packs.loadPrize, (address(stockB), 1 ether, 7_000_000)));
        require(!ok, "inventory mutated during active request");
    }
}
