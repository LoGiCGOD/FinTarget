import axios from 'axios';

const url = 'http://localhost:3000/task';
const userId = 'user123';

const sendRequest = async (requestNumber) => {
    try {
        const response = await axios.post(url, { user_id: userId });
        console.log(`Request ${requestNumber} response:`, response.data);
    } catch (error) {
        console.error(`Error on request ${requestNumber}:`, error.response ? error.response.data : error.message);
    }
};

const sendRequestsSequentially = async (totalRequests) => {
    for (let i = 1; i <= totalRequests; i++) {
        await sendRequest(i);
    }
};

sendRequestsSequentially(50);
