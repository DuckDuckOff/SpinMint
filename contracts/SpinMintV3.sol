// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * SpinMint V3
 *
 * Key changes from V2:
 * - Prizes accumulate in claimable[user] instead of auto-sending
 * - claim(address to) lets users withdraw to any Base address
 * - sweepExpired(address[]) lets owner reclaim prizes unclaimed after 7 days → jackpot
 * - lastWin[user] timestamp tracks the 7-day expiry window
 */
contract SpinMintV3 is ERC1155, Ownable, ReentrancyGuard {

    // ─── Constants ────────────────────────────────────────────────────────────
    IERC20 public immutable USDC;
    uint256 public constant SPIN_PRICE   = 1_000_000; // $1.00 USDC (6 decimals)
    uint256 public constant BIG_WIN      = 3_000_000; // $3.00 USDC
    uint256 public constant SMALL_WIN    = 2_000_000; // $2.00 USDC
    uint256 public constant JACKPOT_SEED = 100_000;   // 10% of each spin seeds jackpot
    uint256 public constant CLAIM_EXPIRY = 7 days;

    // ─── State ────────────────────────────────────────────────────────────────
    uint256 public jackpotPool;
    uint256 public totalMints;

    // Claimable prize balances
    mapping(address => uint256) public claimable;
    mapping(address => uint256) public lastWin; // timestamp of last win, 0 if none pending

    // User gameplay info
    mapping(address => uint256) public streak;
    mapping(address => bool)    public hasFreecastSpin;
    mapping(address => uint256) public spinTickets;
    mapping(address => uint256) public totalRaresMinted;

    // Rare NFT metadata
    mapping(uint256 => uint256) private _rareSeed;
    mapping(uint256 => address) private _rareMinter;
    uint256 private _nextRareId = 1;

    // ─── Events ───────────────────────────────────────────────────────────────
    event Minted(address indexed user, uint256 indexed tokenId, uint256 amount);
    event SpinResult(address indexed user, uint256 prize, bool isJackpot);
    event JackpotWon(address indexed winner, uint256 amount);
    event FreeSpinGranted(address indexed user);
    event FreeSpinUsed(address indexed user);
    event PrizeClaimed(address indexed user, address indexed to, uint256 amount);
    event PrizeExpiredToJackpot(address indexed user, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _usdc, address _owner)
        ERC1155("")
        Ownable(_owner)
    {
        USDC = IERC20(_usdc);
    }

    // ─── Spin ─────────────────────────────────────────────────────────────────
    function mintAndSpin() external nonReentrant {
        require(USDC.transferFrom(msg.sender, address(this), SPIN_PRICE), "USDC transfer failed");
        jackpotPool += JACKPOT_SEED;
        totalMints++;
        spinTickets[msg.sender]++;
        _spin(msg.sender);
    }

    function useFreeSpin() external nonReentrant {
        require(hasFreecastSpin[msg.sender], "No free spin available");
        hasFreecastSpin[msg.sender] = false;
        emit FreeSpinUsed(msg.sender);
        _spin(msg.sender);
    }

    function _spin(address user) internal {
        // On-chain randomness — acceptable for low-stakes gaming
        uint256 seed = uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            user,
            totalMints,
            jackpotPool
        )));
        uint256 roll = seed % 100;

        if (roll < 2) {
            // ── JACKPOT (2%) ──────────────────────────────────────────────────
            uint256 prize = jackpotPool;
            jackpotPool = 0;
            _awardPrize(user, prize);
            streak[user]++;
            emit SpinResult(user, prize, true);
            emit JackpotWon(user, prize);

        } else if (roll < 10) {
            // ── BIG WIN $3 (8%) ───────────────────────────────────────────────
            _awardPrize(user, BIG_WIN);
            streak[user]++;
            emit SpinResult(user, BIG_WIN, false);

        } else if (roll < 25) {
            // ── SMALL WIN $2 (15%) ────────────────────────────────────────────
            _awardPrize(user, SMALL_WIN);
            streak[user]++;
            emit SpinResult(user, SMALL_WIN, false);

        } else if (roll < 45) {
            // ── RARE NFT (20%) ────────────────────────────────────────────────
            uint256 tokenId = _nextRareId++;
            _rareSeed[tokenId]   = seed;
            _rareMinter[tokenId] = user;
            totalRaresMinted[user]++;
            streak[user]++;
            _mint(user, tokenId, 1, "");
            emit Minted(user, tokenId, 1);
            emit SpinResult(user, 0, false);

        } else {
            // ── NOTHING (55%) ─────────────────────────────────────────────────
            streak[user] = 0;
            emit SpinResult(user, 0, false);
        }
    }

    // Credits user's claimable balance and stamps timestamp
    function _awardPrize(address user, uint256 amount) internal {
        claimable[user] += amount;
        lastWin[user] = block.timestamp;
    }

    // ─── Claim ────────────────────────────────────────────────────────────────
    /// @notice Withdraw accumulated winnings to any Base address
    function claim(address to) external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "Nothing to claim");
        require(to != address(0), "Invalid address");
        claimable[msg.sender] = 0;
        lastWin[msg.sender]   = 0;
        require(USDC.transfer(to, amount), "Transfer failed");
        emit PrizeClaimed(msg.sender, to, amount);
    }

    // ─── Sweep ────────────────────────────────────────────────────────────────
    /// @notice Owner sweeps prizes unclaimed for 7+ days back into the jackpot pool
    function sweepExpired(address[] calldata users) external onlyOwner {
        uint256 total;
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            if (
                lastWin[user] > 0 &&
                block.timestamp - lastWin[user] >= CLAIM_EXPIRY &&
                claimable[user] > 0
            ) {
                uint256 amount = claimable[user];
                claimable[user] = 0;
                lastWin[user]   = 0;
                total += amount;
                emit PrizeExpiredToJackpot(user, amount);
            }
        }
        if (total > 0) jackpotPool += total;
    }

    // ─── Free Spins ───────────────────────────────────────────────────────────
    function grantFreeSpin(address user) external onlyOwner {
        hasFreecastSpin[user] = true;
        emit FreeSpinGranted(user);
    }

    function batchGrantFreeSpins(address[] calldata users) external onlyOwner {
        for (uint256 i = 0; i < users.length; i++) {
            hasFreecastSpin[users[i]] = true;
            emit FreeSpinGranted(users[i]);
        }
    }

    // ─── Views ────────────────────────────────────────────────────────────────
    function getStats() external view returns (
        uint256 _jackpotPool,
        uint256 _totalMints,
        uint256 _contractBalance
    ) {
        return (jackpotPool, totalMints, USDC.balanceOf(address(this)));
    }

    function getUserInfo(address user) external view returns (
        uint256 _streak,
        bool    _hasFreecastSpin,
        uint256 _spinTickets,
        uint256 _totalRaresMinted
    ) {
        return (streak[user], hasFreecastSpin[user], spinTickets[user], totalRaresMinted[user]);
    }

    function getClaimable(address user) external view returns (
        uint256 amount,
        uint256 expiresAt
    ) {
        uint256 exp = lastWin[user] > 0 ? lastWin[user] + CLAIM_EXPIRY : 0;
        return (claimable[user], exp);
    }

    function getRareInfo(uint256 tokenId) external view returns (
        uint256 seed,
        address minter,
        bool    exists
    ) {
        return (_rareSeed[tokenId], _rareMinter[tokenId], _rareMinter[tokenId] != address(0));
    }

    // ─── Owner ────────────────────────────────────────────────────────────────
    function seedJackpot(uint256 amount) external onlyOwner {
        require(USDC.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        jackpotPool += amount;
    }

    function setURI(string calldata newuri) external onlyOwner {
        _setURI(newuri);
    }

    function emergencyWithdraw() external onlyOwner {
        uint256 bal = USDC.balanceOf(address(this));
        USDC.transfer(owner(), bal);
    }
}
