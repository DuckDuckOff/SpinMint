import "@stdlib/deploy";
import "@stdlib/ownable";

// ── Messages ──────────────────────────────────────────────────────────────────
message(0x7370696e) Spin {}
message(0x66726565) FreeSpin {}    // "free" — use a banked free spin
message(0x636c6169) Claim {}
message(0x73656564) Seed {}

// Jetton transfer (to send SPINMINT prizes)
message(0x0f8a7ea5) JettonTransfer {
    queryId:             Int as uint64;
    amount:              Int as coins;
    destination:         Address;
    responseDestination: Address?;
    customPayload:       Cell?;
    forwardTonAmount:    Int as coins;
    forwardPayload:      Slice as remaining;
}

message SetSpinmintWallet { walletAddress: Address; }

message SpinResult {
    tier:  Int as uint8;
    prize: Int as coins;
    smPrize: Int as coins;
}

// ── Tiers ─────────────────────────────────────────────────────────────────────
// 0  Jackpot       0.05%   full TON pool
// 1  Big Win       0.20%   5 TON
// 2  TON Win       3.90%   1.5 TON
// 3  SM Big        9.60%   3,000 SPINMINT
// 4  SM Small     18.00%   2,000 SPINMINT
// 5  Free Spin    10.00%   150 SPINMINT + free spin credit
// 6  Try Again    58.25%   50 SPINMINT

// ── SPINMINT amounts (9 decimals) ─────────────────────────────────────────────
// 3000 SM = 3_000_000_000_000  nanoSM
// 2000 SM = 2_000_000_000_000  nanoSM
//  150 SM =   150_000_000_000  nanoSM
//   50 SM =    50_000_000_000  nanoSM

// ── Contract ──────────────────────────────────────────────────────────────────
contract SpinMint with Deployable, Ownable {

    owner:      Address;
    jackpot:    Int as coins;
    totalSpins: Int as uint32;

    claimable:  map<Address, Int as coins>;
    lastWin:    map<Address, Int as uint64>;
    freeSpins:  map<Address, Int as uint32>;

    spinmintWallet: Address?;   // This contract's own SPINMINT jetton wallet

    init(owner: Address) {
        self.owner          = owner;
        self.jackpot        = 0;
        self.totalSpins     = 0;
        self.spinmintWallet = null;
    }

    // Owner sets the jetton wallet address after deployment
    receive(msg: SetSpinmintWallet) {
        self.requireOwner();
        self.spinmintWallet = msg.walletAddress;
    }

    receive(msg: Spin) {
        let ctx: Context = context();
        let spinCost: Int = ton("1");
        require(ctx.value >= spinCost + ton("0.05"), "Send at least 1.05 TON");

        self.jackpot    = self.jackpot + spinCost * 70 / 100;
        self.totalSpins = self.totalSpins + 1;

        let sender: Address = ctx.sender;
        self.doSpin(sender, ctx.value, spinCost);
    }

    // Use a banked free spin — only costs gas (0.05 TON)
    receive(msg: FreeSpin) {
        let ctx: Context = context();
        require(ctx.value >= ton("0.05"), "Send 0.05 TON for gas");

        let sender: Address = ctx.sender;
        let maybeFs: Int? = self.freeSpins.get(sender);
        let fs: Int = maybeFs != null ? maybeFs!! : 0;
        require(fs > 0, "No free spins banked");

        self.freeSpins.set(sender, fs - 1);
        self.totalSpins = self.totalSpins + 1;

        self.doSpin(sender, ctx.value, 0);
    }

    receive(msg: Claim) {
        let sender: Address = context().sender;
        let maybeAmt: Int? = self.claimable.get(sender);
        let amount: Int = maybeAmt != null ? maybeAmt!! : 0;
        require(amount > 0, "Nothing to claim");

        let maybeWon: Int? = self.lastWin.get(sender);
        let won: Int = maybeWon != null ? maybeWon!! : 0;
        require(now() - won <= 604800, "Winnings expired");

        self.claimable.set(sender, 0);
        send(SendParameters{
            to:     sender,
            value:  amount,
            bounce: false,
            mode:   SendIgnoreErrors,
        });
    }

    receive(msg: Seed) {
        self.requireOwner();
        self.jackpot = self.jackpot + context().value - ton("0.05");
    }

    receive("sweep") {
        self.requireOwner();
    }

    // ── Spin logic ────────────────────────────────────────────────────────────

    fun doSpin(sender: Address, paid: Int, spinCost: Int) {
        nativeRandomizeLt();
        let rand: Int = abs(nativeRandom()) % 10000;

        let tier:    Int = 6;
        let prize:   Int = 0;
        let smPrize: Int = 0;

        if (rand < 5) {
            // 0.05% Jackpot
            tier  = 0;
            prize = self.jackpot;
            self.jackpot = 0;
        } else if (rand < 25) {
            // 0.20% Big Win — 5 TON
            tier  = 1;
            prize = ton("5");
        } else if (rand < 415) {
            // 3.90% TON Win — 1.5 TON
            tier  = 2;
            prize = ton("1.5");
        } else if (rand < 1375) {
            // 9.60% SM Big — 3,000 SPINMINT
            tier    = 3;
            smPrize = 3000000000000;
        } else if (rand < 3175) {
            // 18.00% SM Small — 2,000 SPINMINT
            tier    = 4;
            smPrize = 2000000000000;
        } else if (rand < 4175) {
            // 10.00% Free Spin — 150 SPINMINT + free spin credit
            tier    = 5;
            smPrize = 150000000000;
            let maybeFs: Int? = self.freeSpins.get(sender);
            let fs: Int = maybeFs != null ? maybeFs!! : 0;
            self.freeSpins.set(sender, fs + 1);
        } else {
            // 58.25% Try Again — 50 SPINMINT consolation
            tier    = 6;
            smPrize = 50000000000;
        }

        // Bank TON prize to claimable
        if (prize > 0) {
            let maybeVal: Int? = self.claimable.get(sender);
            let current: Int = maybeVal != null ? maybeVal!! : 0;
            self.claimable.set(sender, current + prize);
            self.lastWin.set(sender, now());
        }

        // Send SPINMINT prize via jetton wallet
        if (smPrize > 0 && self.spinmintWallet != null) {
            send(SendParameters{
                to:    self.spinmintWallet!!,
                value: ton("0.08"),
                mode:  SendIgnoreErrors,
                body:  JettonTransfer{
                    queryId:             0,
                    amount:              smPrize,
                    destination:         sender,
                    responseDestination: sender,
                    customPayload:       null,
                    forwardTonAmount:    ton("0.01"),
                    forwardPayload:      emptySlice(),
                }.toCell(),
            });
        }

        emit(SpinResult{ tier: tier, prize: prize, smPrize: smPrize }.toCell());

        // Refund excess TON
        let excess: Int = paid - spinCost - ton("0.05");
        if (smPrize > 0) { excess = excess - ton("0.08"); } // deduct jetton gas
        if (excess > 0) {
            send(SendParameters{
                to:    sender,
                value: excess,
                mode:  SendIgnoreErrors,
            });
        }
    }

    // ── Getters ───────────────────────────────────────────────────────────────

    get fun jackpot(): Int { return self.jackpot; }
    get fun totalSpins(): Int { return self.totalSpins; }

    get fun claimable(user: Address): Int {
        let v: Int? = self.claimable.get(user);
        return v != null ? v!! : 0;
    }

    get fun lastWin(user: Address): Int {
        let v: Int? = self.lastWin.get(user);
        return v != null ? v!! : 0;
    }

    get fun freeSpins(user: Address): Int {
        let v: Int? = self.freeSpins.get(user);
        return v != null ? v!! : 0;
    }
}
