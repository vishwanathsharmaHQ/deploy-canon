require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      chainId: 1337,
      loggingEnabled: true,
      mining: {
        auto: true,
        interval: 0
      }
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk"
      },
      loggingEnabled: true,
      mining: {
        auto: true,
        interval: 0
      }
    }
  },
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    sources: './contracts',
    tests: './test',
  }
}; 