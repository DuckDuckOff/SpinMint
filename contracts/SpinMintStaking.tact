import "@stdlib/deploy";
import "@stdlib/ownable";

// ── Jetton messages needed ────────────────────────────────────────────────────
message(0x0f8a7ea5) JettonTransfer {
    queryId:             Int as uint64;
    amount:              Int as coins;
    destination:         Address;
    responseDestination: Address?;
    customPayload:       Cell?;
    forwardTonAmount:    Int as coins;
    forwardPayload:      Slice as remaining;
}

message(0x7362d09c) JettonTransferNotification {
    queryId:        Int as uint64;
    amount:         Int as coins;
    sender:         Address;
    forwardPayload: Slice as remaining;
}

message(0xd53276db) JettonExcesses {
    queryId: Int as uint64;
}

// ── Staking messages ──────────────────────────────────────────────────────────
message SetJettonWallet { walletAddress: Address; }
message Unstake {}
message ClaimRewards {}

// ── Tiers ─────────────────────────────────────────────────────────────────────
// 0 = Flexible  12% APY  no lock
// 1 = 30-day    24% APY  2,592,000s
// 2 = 90-day    48% APY  7,776,000s
// 3 = 180-day   96% APY 15,552,000s

// ── Staking Contract ──────────────────────────────────────────────────────────
contract SpinMintStaking with Deployable, Ownable {

    owner:        Address;
    jettonWallet: Address?;

    stakeAmount:    map<Address, Int as coins>;
    stakeTier:      map<Address, Int as uint8>;
    stakeStart:     map<Address, Int as uint64>;
    stakeLastClaim: map<Address, Int as uint64>;

    init(owner: Address) {
        self.owner        = owner;
        self.jettonWallet = null;
    }

    // Owner sets this contract's own jetton wallet address after deployment
    receive(msg: SetJettonWallet) {
        self.requireOwner();
        self.jettonWallet = msg.walletAddress;
    }

    // Called when user sends SPINMINT to this contract via JettonTransfer
    // forwardPayload must contain tier as uint8 (0-3)
    receive(msg: JettonTransferNotification) {
        let user: Address = msg.sender;

        // Reject if user already has an active stake
        let maybeAmt: Int? = self.stakeAmount.get(user);
        let existing: Int = maybeAmt != null ? maybeAmt!! : 0;
        require(existing == 0, "Already staking — unstake first");

        // Read tier from payload (default 0 if not provided)
        let tier: Int = 0;
        let payload: Slice = msg.forwardPayload;
        if (payload.bits() >= 8) {
            tier = payload.loadUint(8);
        }
        require(tier >= 0 && tier <= 3, "Invalid tier");

        self.stakeAmount.set(user, msg.amount);
        self.stakeTier.set(user, tier);
        self.stakeStart.set(user, now());
        self.stakeLastClaim.set(user, now());
    }

    // Claim accrued rewards without unstaking
    receive(msg: ClaimRewards) {
        let user: Address = sender();
        let maybeAmt: Int? = self.stakeAmount.get(user);
        let amount: Int = maybeAmt != null ? maybeAmt!! : 0;
        require(amount > 0, "Nothing staked");

        let maybeTier: Int? = self.stakeTier.get(user);
        let tier: Int = maybeTier != null ? maybeTier!! : 0;

        let maybeLC: Int? = self.stakeLastClaim.get(user);
        let lastClaim: Int = maybeLC != null ? maybeLC!! : now();

        let elapsed: Int = now() - lastClaim;
        let reward: Int = self.calcReward(amount, tier, elapsed);
        require(reward > 0, "No rewards yet");

        self.stakeLastClaim.set(user, now());
        self.sendJettons(user, reward);
    }

    // Unstake principal + claim remaining rewards
    receive(msg: Unstake) {
        let user: Address = sender();
        let maybeAmt: Int? = self.stakeAmount.get(user);
        let amount: Int = maybeAmt != null ? maybeAmt!! : 0;
        require(amount > 0, "Nothing staked");

        let maybeTier: Int? = self.stakeTier.get(user);
        let tier: Int = maybeTier != null ? maybeTier!! : 0;

        let maybeStart: Int? = self.stakeStart.get(user);
        let stakeStart: Int = maybeStart != null ? maybeStart!! : now();

        // Check lock period
        let lockPeriod: Int = self.lockPeriod(tier);
        require(now() - stakeStart >= lockPeriod, "Still locked");

        let maybeLC: Int? = self.stakeLastClaim.get(user);
        let lastClaim: Int = maybeLC != null ? maybeLC!! : stakeStart;
        let elapsed: Int = now() - lastClaim;
        let reward: Int = self.calcReward(amount, tier, elapsed);

        // Clear stake
        self.stakeAmount.set(user, 0);
        self.stakeTier.set(user, 0);
        self.stakeStart.set(user, 0);
        self.stakeLastClaim.set(user, 0);

        // Return principal + rewards
        let total: Int = amount + reward;
        self.sendJettons(user, total);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fun calcReward(amount: Int, tier: Int, elapsed: Int): Int {
        let apyBps: Int = 1200; // 12.00%
        if (tier == 1) { apyBps = 2400; }
        else if (tier == 2) { apyBps = 4800; }
        else if (tier == 3) { apyBps = 9600; }
        // reward = amount * apyBps * elapsed / 10000 / 31536000
        return amount * apyBps * elapsed / 10000 / 31536000;
    }

    fun lockPeriod(tier: Int): Int {
        if (tier == 1) { return 2592000; }  // 30 days
        if (tier == 2) { return 7776000; }  // 90 days
        if (tier == 3) { return 15552000; } // 180 days
        return 0; // flexible
    }

    fun sendJettons(to: Address, amount: Int) {
        require(self.jettonWallet != null, "Jetton wallet not set");
        send(SendParameters{
            to:    self.jettonWallet!!,
            value: ton("0.1"),
            mode:  SendIgnoreErrors,
            body:  JettonTransfer{
                queryId:             0,
                amount:              amount,
                destination:         to,
                responseDestination: to,
                customPayload:       null,
                forwardTonAmount:    ton("0.01"),
                forwardPayload:      emptySlice(),
            }.toCell(),
        });
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    get fun stakeInfo(user: Address): String {
        let maybeAmt: Int? = self.stakeAmount.get(user);
        let amount: Int = maybeAmt != null ? maybeAmt!! : 0;
        return amount.toString();
    }

    get fun stakedAmount(user: Address): Int {
        let v: Int? = self.stakeAmount.get(user);
        return v != null ? v!! : 0;
    }

    get fun stakedTier(user: Address): Int {
        let v: Int? = self.stakeTier.get(user);
        return v != null ? v!! : 0;
    }

    get fun pendingRewards(user: Address): Int {
        let maybeAmt: Int? = self.stakeAmount.get(user);
        let amount: Int = maybeAmt != null ? maybeAmt!! : 0;
        if (amount == 0) { return 0; }

        let maybeTier: Int? = self.stakeTier.get(user);
        let tier: Int = maybeTier != null ? maybeTier!! : 0;

        let maybeLC: Int? = self.stakeLastClaim.get(user);
        let lastClaim: Int = maybeLC != null ? maybeLC!! : now();

        let elapsed: Int = now() - lastClaim;
        return self.calcReward(amount, tier, elapsed);
    }

    get fun unlockTime(user: Address): Int {
        let maybeStart: Int? = self.stakeStart.get(user);
        let stakeStart: Int = maybeStart != null ? maybeStart!! : 0;
        if (stakeStart == 0) { return 0; }

        let maybeTier: Int? = self.stakeTier.get(user);
        let tier: Int = maybeTier != null ? maybeTier!! : 0;

        return stakeStart + self.lockPeriod(tier);
    }
}
