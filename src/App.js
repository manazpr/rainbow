import firebase from 'react-native-firebase';
import PropTypes from 'prop-types';
import React, { Component } from 'react';
import thunk from 'redux-thunk';
import { account, accountInitializeState, accountUpdateAccountAddress, commonStorage } from 'balance-common';
import { AppRegistry } from 'react-native';
import { compose, withProps } from 'recompact';
import { connect, Provider } from 'react-redux';
import { createStore, applyMiddleware, combineReducers } from 'redux';
import { NavigationActions } from 'react-navigation';
import { AlertIOS } from 'react-native';
import Navigation from './navigation';
import Routes from './screens/Routes';
import transactionsToApprove, {
  addTransactionToApprove,
  addTransactionsToApprove,
  transactionIfExists
} from './reducers/transactionsToApprove';
import walletconnect, {
  getValidWalletConnectors,
  setWalletConnectors
} from './reducers/walletconnect';
import {
  walletConnectInitAllConnectors,
  walletConnectGetAllTransactions,
  walletConnectGetTransaction
} from './model/walletconnect';
import { walletInit } from './model/wallet';

const store = createStore(
  combineReducers({ account, transactionsToApprove, walletconnect }),
  applyMiddleware(thunk),
);

class App extends Component {
  static propTypes = {
    accountUpdateAccountAddress: PropTypes.func,
    accountInitializeState: PropTypes.func,
    addTransactionToApprove: PropTypes.func,
    addTransactionsToApprove: PropTypes.func,
    getValidWalletConnectors: PropTypes.func,
    setWalletConnectors: PropTypes.func,
    transactionIfExists: PropTypes.func,
  }

  navigatorRef = null

  componentDidMount() {
    firebase.messaging().getToken()
      .then(fcmToken => {
        if (fcmToken) {
          console.log('received fcmToken', fcmToken);
          commonStorage.saveLocal('balanceWalletFcmToken', { data: fcmToken });
        } else {
          console.log('no fcm token yet');
        }
      });

    this.onTokenRefreshListener = firebase.messaging().onTokenRefresh(fcmToken => {
      console.log('received refreshed fcm token', fcmToken);
      commonStorage.saveLocal('balanceWalletFcmToken', { data: fcmToken });
    });

    this.notificationDisplayedListener = firebase.notifications().onNotificationDisplayed(notification => {
      console.log('on notification displayed - not sure when this is ever called', notification);
      const { transactionId, sessionId } = notification.data;
      this.onPushNotificationOpened(transactionId, sessionId);
    });

    this.notificationListener = firebase.notifications().onNotification(notification => {
      console.log('on notification - while app in foreground');
      const { transactionId, sessionId } = notification.data;
      this.onPushNotificationOpened(transactionId, sessionId);
    });

    this.notificationOpenedListener = firebase.notifications().onNotificationOpened(notificationOpen => {
      console.log('on notification opened - while app in background');
      const { transactionId, sessionId } = notificationOpen.notification.data;
      this.onPushNotificationOpened(transactionId, sessionId);
    });

    this.props.accountInitializeState();

    walletInit()
      .then(walletAddress => {
        console.log('wallet address is', walletAddress);
        this.props.accountUpdateAccountAddress(walletAddress, 'BALANCEWALLET');
        walletConnectInitAllConnectors()
          .then(allConnectors => {
            console.log('got all inited connectors', allConnectors);
            this.props.setWalletConnectors(allConnectors);
            this.fetchAllTransactionsFromWalletConnectSessions(allConnectors);
          })
          .catch(error => {
            console.log('Unable to init all WalletConnect sessions');
          });
        firebase
          .notifications()
          .getInitialNotification()
          .then(notificationOpen => {
            console.log('on initial notification');
            if (notificationOpen) {
              console.log('on initial notification opened - while app closed');
              const { transactionId, sessionId } = notificationOpen.notification.data;
              this.onPushNotificationOpened(transactionId, sessionId);
            }
          });
      })
      .catch(error => {
        console.log('failed to init wallet');
        AlertIOS.alert('Error: Failed to initialize wallet.');
      });
  }

  componentWillUnmount() {
    this.notificationDisplayedListener();
    this.notificationListener();
    this.notificationOpenedListender();
    this.onTokenRefreshListener();
  }

  handleNavigatorRef = (navigatorRef) => { this.navigatorRef = navigatorRef; }

  handleOpenConfirmTransactionModal = (transactionDetails) => {
    // TODO: return if the page selected is the TransactionConfirmationScreen:
    if (!this.navigatorRef) return;

    const action = NavigationActions.navigate({
      routeName: 'ConfirmTransaction',
      params: { transactionDetails },
    });

    Navigation.handleAction(this.navigatorRef, action);
  }

  fetchAllTransactionsFromWalletConnectSessions = async (allConnectors) => {
    if (allConnectors) {
      const allTransactions = await walletConnectGetAllTransactions(allConnectors);
      if (allTransactions) {
        this.props.addTransactionsToApprove(allTransactions);
      }
    } 
  }

  onPushNotificationOpened = async (transactionId, sessionId) => {
    const existingTransaction = this.props.transactionIfExists(transactionId);
    if (existingTransaction) {
      this.handleOpenConfirmTransactionModal(existingTransaction);
    } else {
      const walletConnector = this.props.walletConnectors[sessionId];
      const transactionDetails = await walletConnectGetTransaction(transactionId, walletConnector);
      if (transactionDetails) {
        const { transactionPayload, dappName } = transactionDetails;
        const transaction = this.props.addTransactionToApprove(sessionId, transactionId, transactionPayload, dappName);
        this.handleOpenConfirmTransactionModal(transaction);
      } else {
        AlertIOS.alert('The requested transaction could not be found.');
      }
    }
  }

  render = () => (
    <Provider store={store}>
      <Routes ref={this.handleNavigatorRef} />
    </Provider>
  )
}

const AppWithRedux = compose(
  withProps({ store }),
  connect(
    ({ walletconnect: { walletConnectors } }) => ({ walletConnectors }),
    {
      addTransactionToApprove,
      addTransactionsToApprove,
      accountInitializeState,
      accountUpdateAccountAddress,
      getValidWalletConnectors,
      setWalletConnectors,
      transactionIfExists,
    },
  ),
)(App);

AppRegistry.registerComponent('BalanceWallet', () => AppWithRedux);
