const hre = require("hardhat");
const fs = require('fs');

async function main() {
    const [owner, addr1, addr2] = await ethers.getSigners();
    console.log("Distributing tokens from:", owner.address);

    // Load deployed contract addresses
    const addresses = JSON.parse(fs.readFileSync('deployments.json', 'utf8'));
    
    // Get the token contract
    const CanonToken = await ethers.getContractFactory("CanonToken");
    const canonToken = await CanonToken.attach(addresses.canonToken);

    // Transfer tokens to addr1 and addr2
    const amount = ethers.parseEther("1000"); // 1000 tokens each
    
    await canonToken.transfer(addr1.address, amount);
    console.log(`Transferred ${ethers.formatEther(amount)} tokens to ${addr1.address}`);
    
    await canonToken.transfer(addr2.address, amount);
    console.log(`Transferred ${ethers.formatEther(amount)} tokens to ${addr2.address}`);

    // Print balances
    console.log("\nBalances:");
    console.log("Owner:", ethers.formatEther(await canonToken.balanceOf(owner.address)));
    console.log("Addr1:", ethers.formatEther(await canonToken.balanceOf(addr1.address)));
    console.log("Addr2:", ethers.formatEther(await canonToken.balanceOf(addr2.address)));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 