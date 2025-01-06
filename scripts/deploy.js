const hre = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Deploy CanonToken
    const CanonToken = await ethers.getContractFactory("CanonToken");
    const initialSupply = ethers.parseEther("1000000"); // 1 million tokens
    const canonToken = await CanonToken.deploy(initialSupply);
    await canonToken.waitForDeployment();
    console.log("CanonToken deployed to:", canonToken.target);

    // Deploy CanonThread
    const CanonThread = await ethers.getContractFactory("CanonThread");
    const canonThread = await CanonThread.deploy(canonToken.target);
    await canonThread.waitForDeployment();
    console.log("CanonThread deployed to:", canonThread.target);

    // Save the contract addresses
    const fs = require('fs');
    const addresses = {
        canonToken: canonToken.target,
        canonThread: canonThread.target
    };
    
    fs.writeFileSync(
        'deployments.json',
        JSON.stringify(addresses, null, 2)
    );

    console.log("Addresses saved to deployments.json");
    return addresses;
}

// Execute deployment
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = main; 