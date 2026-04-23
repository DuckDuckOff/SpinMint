import "@stdlib/deploy";
import "@stdlib/ownable";

// ── TEP-74 Jetton Messages ────────────────────────────────────────────────────
message(0x0f8a7ea5) JettonTransfer {
    queryId:             Int as uint64;
    amount:              Int as coins;
    destination:         Address;
    responseDestination: Address?;
    customPayload:       Cell?;
    forwardTonAmount:    Int as coins;
    forwardPayload:      Slice as remaining;
}

message(0x178d4519) JettonInternalTransfer {
    queryId:             Int as uint64;
    amount:              Int as coins;
    from:                Address;
    responseDestination: Address?;
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

message(0x595f07bc) JettonBurn {
    queryId:             Int as uint64;
    amount:              Int as coins;
    responseDestination: Address?;
    customPayload:       Cell?;
}

message(0x7bdd97de) JettonBurnNotification {
    queryId:             Int as uint64;
    amount:              Int as coins;
    sender:              Address;
    responseDestination: Address?;
}

message Mint {
    to:     Address;
    amount: Int as coins;
}

// ── Jetton Wallet (child contract, one per holder) ────────────────────────────
contract JettonWallet {
    balance: Int as coins;
    owner:   Address;
    master:  Address;

    init(owner: Address, master: Address) {
        self.balance = 0;
        self.owner   = owner;
        self.master  = master;
    }

    receive(msg: JettonTransfer) {
        require(sender() == self.owner, "Not owner");
        require(self.balance >= msg.amount, "Insufficient balance");
        self.balance -= msg.amount;

        let destInit: StateInit = initOf JettonWallet(msg.destination, self.master);
        send(SendParameters{
            to:     contractAddress(destInit),
            value:  0,
            mode:   SendRemainingValue,
            bounce: true,
            body:   JettonInternalTransfer{
                queryId:             msg.queryId,
                amount:              msg.amount,
                from:                self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount:    msg.forwardTonAmount,
                forwardPayload:      msg.forwardPayload,
            }.toCell(),
            code: destInit.code,
            data: destInit.data,
        });
    }

    receive(msg: JettonInternalTransfer) {
        self.balance += msg.amount;

        if (msg.forwardTonAmount > 0) {
            send(SendParameters{
                to:    self.owner,
                value: msg.forwardTonAmount,
                mode:  SendIgnoreErrors,
                body:  JettonTransferNotification{
                    queryId:        msg.queryId,
                    amount:         msg.amount,
                    sender:         msg.from,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }

        if (msg.responseDestination != null) {
            send(SendParameters{
                to:    msg.responseDestination!!,
                value: 0,
                mode:  SendRemainingValue + SendIgnoreErrors,
                body:  JettonExcesses{ queryId: msg.queryId }.toCell(),
            });
        }
    }

    receive(msg: JettonBurn) {
        require(sender() == self.owner, "Not owner");
        require(self.balance >= msg.amount, "Insufficient balance");
        self.balance -= msg.amount;
        send(SendParameters{
            to:    self.master,
            value: 0,
            mode:  SendRemainingValue,
            body:  JettonBurnNotification{
                queryId:             msg.queryId,
                amount:              msg.amount,
                sender:              self.owner,
                responseDestination: msg.responseDestination,
            }.toCell(),
        });
    }

    get fun balance(): Int { return self.balance; }
    get fun owner(): Address { return self.owner; }
}

// ── Jetton Master ─────────────────────────────────────────────────────────────
contract SpinMintJetton with Deployable, Ownable {
    owner:       Address;
    totalSupply: Int as coins;
    mintable:    Bool;

    init(owner: Address) {
        self.owner       = owner;
        self.totalSupply = 0;
        self.mintable    = true;
    }

    receive(msg: Mint) {
        self.requireOwner();
        require(self.mintable, "Minting disabled");
        self.totalSupply += msg.amount;

        let walletInit: StateInit = initOf JettonWallet(msg.to, myAddress());
        send(SendParameters{
            to:     contractAddress(walletInit),
            value:  ton("0.05"),
            mode:   SendIgnoreErrors,
            bounce: false,
            body:   JettonInternalTransfer{
                queryId:             0,
                amount:              msg.amount,
                from:                myAddress(),
                responseDestination: self.owner,
                forwardTonAmount:    0,
                forwardPayload:      emptySlice(),
            }.toCell(),
            code: walletInit.code,
            data: walletInit.data,
        });
    }

    receive(msg: JettonBurnNotification) {
        let expectedWallet: Address = contractAddress(initOf JettonWallet(msg.sender, myAddress()));
        require(sender() == expectedWallet, "Invalid wallet");
        self.totalSupply -= msg.amount;
        if (msg.responseDestination != null) {
            send(SendParameters{
                to:    msg.responseDestination!!,
                value: 0,
                mode:  SendRemainingValue + SendIgnoreErrors,
                body:  JettonExcesses{ queryId: msg.queryId }.toCell(),
            });
        }
    }

    receive("stopMint") {
        self.requireOwner();
        self.mintable = false;
    }

    get fun totalSupply(): Int { return self.totalSupply; }
    get fun mintable(): Bool   { return self.mintable; }

    get fun walletAddress(owner: Address): Address {
        return contractAddress(initOf JettonWallet(owner, myAddress()));
    }
}
